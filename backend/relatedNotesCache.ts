import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getAppDataDir } from "./config.js";
import {
  MARKDOWN_SOURCE_DERIVATION_VERSION,
  STRUCTURAL_INDEX_DERIVATION_VERSION,
  vaultRootHash,
  type MachineIndexResult,
} from "./indexCache.js";
import { normalizeMarkdownFilePath } from "./path.js";
import { PublicApiError } from "./publicApiError.js";
import { deriveRelatedNotesCorpus, type RelatedNotesSource } from "./relatedNotes.js";
import type { VaultInfo } from "./types.js";
import { readVaultFile } from "./vaultFs.js";
import {
  RELATED_NOTES_DERIVATION_VERSION,
  RELATED_NOTES_PRODUCER,
  RELATED_NOTES_PRODUCER_VERSION,
  type RelatedNotesResponse,
} from "../src/lib/vault/enrichmentContracts.js";
import type { GeneratedDataRemoval } from "./indexCache.js";

export const RELATED_NOTES_CACHE_VERSION = 1;
const RELATED_NOTES_READ_CONCURRENCY = 8;
const relatedNotesLocks = new Map<string, Promise<void>>();

type StoredRelatedNotesCache = {
  kind: "arepo.relatedNotesEnrichment";
  version: 1;
  producer: typeof RELATED_NOTES_PRODUCER;
  producerVersion: number;
  derivationVersion: number;
  structuralDerivationVersion: number;
  markdownSourceDerivationVersion: number;
  generatedAt: string;
  vault: { id: string; rootPathHash: string };
  corpusHash: string;
  results: RelatedNotesResponse[];
};

export type RelatedNotesCacheResult = {
  data: RelatedNotesResponse;
  cacheStatus: "hit" | "rebuilt";
};

export async function getRelatedNotes(
  vault: VaultInfo,
  rawPath: unknown,
  machine: MachineIndexResult,
  cwd = process.cwd(),
): Promise<RelatedNotesCacheResult> {
  if (!vault.permissions.readIndex || !vault.permissions.readContent) {
    throw new PublicApiError(403, "Related-note enrichment is not available.", {
      code: "related-notes-not-permitted",
    });
  }
  let sourcePath: string;
  try {
    sourcePath = normalizeMarkdownFilePath(rawPath);
  } catch {
    throw new PublicApiError(400, "Related notes require a valid Markdown path.", {
      code: "invalid-related-notes-path",
    });
  }
  const readable = machine.manifest.sources.filter(
    (source): source is Extract<typeof source, { state: "readable" }> =>
      source.state === "readable" && Boolean(machine.data.index.notes[source.path]),
  );
  const sourceManifest = readable.find((source) => source.path === sourcePath);
  if (!sourceManifest || !machine.data.index.notes[sourcePath]) {
    throw new PublicApiError(404, "Related notes are unavailable for this source.", {
      code: "related-notes-source-unavailable",
    });
  }
  const corpusHash = relatedNotesCorpusHash(readable);
  const file = await relatedNotesCachePath(vault, cwd);
  return withRelatedNotesLock(file, async () => {
    const rootPathHash = await vaultRootHash(vault);
    const stored = await readStoredCache(file);
    if (isCurrentCache(stored, vault, rootPathHash, corpusHash, readable)) {
      const result = stored.results.find((entry) => entry.sourcePath === sourcePath);
      if (result && result.sourceHash === sourceManifest.contentHash) {
        return { data: result, cacheStatus: "hit" };
      }
    }

    const bodies = await mapWithConcurrency(
      readable,
      RELATED_NOTES_READ_CONCURRENCY,
      async (item) => {
        const fileResponse = await readVaultFile(vault, item.path);
        if (fileResponse.hash !== item.contentHash) {
          throw new PublicApiError(409, "Sources changed while related notes were being derived.", {
            code: "related-notes-source-changed",
          });
        }
        return [item.path, fileResponse.content] as const;
      },
    );
    const contentByPath = new Map(bodies);
    const sources: RelatedNotesSource[] = readable.map((item) => ({
      path: item.path,
      sourceHash: item.contentHash,
      content: contentByPath.get(item.path) ?? "",
      note: machine.data.index.notes[item.path],
      resolvedOutgoingPaths: (machine.data.index.outgoingLinks[item.path] ?? [])
        .filter((link) => link.status === "resolved" && typeof link.targetPath === "string")
        .map((link) => link.targetPath as string)
        .sort((a, b) => a.localeCompare(b)),
    }));
    const generatedAt = new Date().toISOString();
    const derived = deriveRelatedNotesCorpus(sources, corpusHash, generatedAt);
    const result = derived.results.get(sourcePath);
    if (!result) {
      throw new PublicApiError(404, "Related notes are unavailable for this source.", {
        code: "related-notes-source-unavailable",
      });
    }
    const cache: StoredRelatedNotesCache = {
      kind: "arepo.relatedNotesEnrichment",
      version: RELATED_NOTES_CACHE_VERSION,
      producer: RELATED_NOTES_PRODUCER,
      producerVersion: RELATED_NOTES_PRODUCER_VERSION,
      derivationVersion: RELATED_NOTES_DERIVATION_VERSION,
      structuralDerivationVersion: STRUCTURAL_INDEX_DERIVATION_VERSION,
      markdownSourceDerivationVersion: MARKDOWN_SOURCE_DERIVATION_VERSION,
      generatedAt,
      vault: { id: vault.id, rootPathHash },
      corpusHash,
      results: [...derived.results.values()].sort((a, b) =>
        a.sourcePath.localeCompare(b.sourcePath),
      ),
    };
    await writeStoredCache(file, cache);
    return { data: result, cacheStatus: "rebuilt" };
  });
}

export function relatedNotesCorpusHash(
  readable: Array<{ path: string; contentHash: string }>,
): string {
  const canonical = {
    producer: RELATED_NOTES_PRODUCER,
    producerVersion: RELATED_NOTES_PRODUCER_VERSION,
    derivationVersion: RELATED_NOTES_DERIVATION_VERSION,
    structuralDerivationVersion: STRUCTURAL_INDEX_DERIVATION_VERSION,
    markdownSourceDerivationVersion: MARKDOWN_SOURCE_DERIVATION_VERSION,
    sources: readable
      .map(({ path: sourcePath, contentHash }) => [sourcePath, contentHash] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function relatedNotesCachePath(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<string> {
  const safeVaultId = vault.id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(
    await getAppDataDir(cwd),
    "enrichments",
    `${safeVaultId}-${await vaultRootHash(vault)}.related-notes.json`,
  );
}

export async function removeRelatedNotesCacheIfOwned(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<GeneratedDataRemoval> {
  const file = await relatedNotesCachePath(vault, cwd);
  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return { deletedPaths: [], diagnostics: [] };
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { deletedPaths: [], diagnostics: ["Related-note cache was not a regular owned file."] };
  }
  const parsed = await readStoredCache(file);
  const rootPathHash = await vaultRootHash(vault);
  if (
    !isRecord(parsed) ||
    parsed.kind !== "arepo.relatedNotesEnrichment" ||
    parsed.version !== RELATED_NOTES_CACHE_VERSION ||
    !isRecord(parsed.vault) ||
    parsed.vault.id !== vault.id ||
    parsed.vault.rootPathHash !== rootPathHash
  ) {
    return {
      deletedPaths: [],
      diagnostics: ["Related-note cache ownership could not be verified."],
    };
  }
  await fs.unlink(file);
  return { deletedPaths: [file], diagnostics: [] };
}

async function readStoredCache(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function isCurrentCache(
  value: unknown,
  vault: VaultInfo,
  rootPathHash: string,
  corpusHash: string,
  readable: Array<{ path: string; contentHash: string }>,
): value is StoredRelatedNotesCache {
  if (!isRecord(value)) return false;
  if (
    value.kind !== "arepo.relatedNotesEnrichment" ||
    value.version !== RELATED_NOTES_CACHE_VERSION ||
    value.producer !== RELATED_NOTES_PRODUCER ||
    value.producerVersion !== RELATED_NOTES_PRODUCER_VERSION ||
    value.derivationVersion !== RELATED_NOTES_DERIVATION_VERSION ||
    value.structuralDerivationVersion !== STRUCTURAL_INDEX_DERIVATION_VERSION ||
    value.markdownSourceDerivationVersion !== MARKDOWN_SOURCE_DERIVATION_VERSION ||
    value.corpusHash !== corpusHash ||
    !isRecord(value.vault) ||
    value.vault.id !== vault.id ||
    value.vault.rootPathHash !== rootPathHash ||
    typeof value.generatedAt !== "string" ||
    !Array.isArray(value.results)
  )
    return false;
  const expected = new Map(readable.map((source) => [source.path, source.contentHash]));
  return (
    value.results.length === expected.size &&
    new Set(value.results.map((result) => (isRecord(result) ? result.sourcePath : undefined)))
      .size === expected.size &&
    value.results.every(
      (result) =>
        isStoredResponse(result) &&
        result.corpusHash === corpusHash &&
        expected.get(result.sourcePath) === result.sourceHash &&
        result.candidates.every(
          (candidate) => expected.get(candidate.targetPath) === candidate.targetHash,
        ),
    )
  );
}

function isStoredResponse(value: unknown): value is RelatedNotesResponse {
  return (
    isRecord(value) &&
    value.status === "ready" &&
    isMarkdownPath(value.sourcePath) &&
    isSha256(value.sourceHash) &&
    isSha256(value.corpusHash) &&
    value.producer === RELATED_NOTES_PRODUCER &&
    value.producerVersion === RELATED_NOTES_PRODUCER_VERSION &&
    value.derivationVersion === RELATED_NOTES_DERIVATION_VERSION &&
    typeof value.generatedAt === "string" &&
    Array.isArray(value.candidates) &&
    value.candidates.length <= 10 &&
    value.candidates.every(
      (candidate) =>
        isRecord(candidate) &&
        isMarkdownPath(candidate.targetPath) &&
        candidate.targetPath !== value.sourcePath &&
        isSha256(candidate.targetHash) &&
        typeof candidate.title === "string" &&
        candidate.title.length <= 1_024 &&
        isUnitScore(candidate.score) &&
        Array.isArray(candidate.evidence) &&
        candidate.evidence.length > 0 &&
        candidate.evidence.length <= 5 &&
        candidate.evidence.every(isStoredEvidence),
    )
  );
}

function isStoredEvidence(value: unknown): boolean {
  if (!isRecord(value) || !isUnitScore(value.score)) return false;
  if (value.kind === "tag-overlap") return isBoundedStrings(value.sharedTags, false);
  if (
    value.kind === "title-term-overlap" ||
    value.kind === "heading-term-overlap" ||
    value.kind === "lexical-similarity"
  )
    return isBoundedStrings(value.sharedTerms, false);
  if (value.kind === "common-neighbours") {
    return (
      Array.isArray(value.paths) &&
      value.paths.length > 0 &&
      value.paths.length <= 8 &&
      value.paths.every(isMarkdownPath)
    );
  }
  return false;
}

function isBoundedStrings(value: unknown, allowEmpty: boolean): boolean {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.length <= 8 &&
    value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 128)
  );
}

function isMarkdownPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.toLowerCase().endsWith(".md") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isUnitScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

async function writeStoredCache(file: string, cache: StoredRelatedNotesCache): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.unlink(temporary).catch((unlinkError: NodeJS.ErrnoException) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}

async function withRelatedNotesLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const previous = relatedNotesLocks.get(file) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  relatedNotesLocks.set(file, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (relatedNotesLocks.get(file) === tail) relatedNotesLocks.delete(file);
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(values.length, concurrency) }, async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        results[index] = await operation(values[index]);
      }
    }),
  );
  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
