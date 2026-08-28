import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getAppDataDir } from "./config.js";
import type { MachineIndexResult } from "./indexCache.js";
import { normalizeMarkdownFilePath } from "./path.js";
import { PublicApiError } from "./publicApiError.js";
import type { VaultInfo } from "./types.js";
import { hasExplicitRelationship } from "../src/lib/vault/indexer.js";
import {
  RELATED_NOTES_CURATION_KIND,
  RELATED_NOTES_CURATION_MAX_DECISIONS,
  RELATED_NOTES_CURATION_VERSION,
  RELATED_NOTES_PRODUCER,
  RELATED_NOTES_PRODUCER_VERSION,
  compareRelatedNotesCurationPaths,
  type RelatedNotesCurationDecision,
  type RelatedNotesCurationFreshness,
  type RelatedNotesCurationMutationResponse,
  type RelatedNotesCurationPresentation,
  type RelatedNotesCurationRecord,
  type RelatedNotesCurationResponse,
  type RelatedNotesDerivedResponse,
  type RelatedNotesResponse,
} from "../src/lib/vault/enrichmentContracts.js";

const CURATION_MAX_BYTES = 4 * 1024 * 1024;
const INVALID_DIAGNOSTIC =
  "Stored Related Notes curation was invalid or unreadable; no decisions were applied.";
const curationWriteLocks = new Map<string, Promise<void>>();

type StoredRelatedNotesCuration = {
  kind: typeof RELATED_NOTES_CURATION_KIND;
  version: typeof RELATED_NOTES_CURATION_VERSION;
  vaultId: string;
  decisions: RelatedNotesCurationRecord[];
};

type StoredRead =
  | { status: "missing"; store: StoredRelatedNotesCuration }
  | { status: "ready"; store: StoredRelatedNotesCuration }
  | { status: "invalid" };

export async function relatedNotesCurationPath(
  vault: Pick<VaultInfo, "id">,
  cwd = process.cwd(),
): Promise<string> {
  return path.join(await getAppDataDir(cwd), "curation", `${vault.id}.related-notes.json`);
}

export async function readRelatedNotesCuration(
  vault: VaultInfo,
  machine: MachineIndexResult,
  rawPath: unknown,
  canMutate: boolean,
  cwd = process.cwd(),
): Promise<RelatedNotesCurationResponse> {
  requireReadPermission(vault);
  const sourcePath = rawPath === undefined || rawPath === null ? undefined : curationPath(rawPath);
  const file = await relatedNotesCurationPath(vault, cwd);
  const read = await readStoredCuration(file, vault.id);
  if (read.status === "invalid") {
    return {
      status: "invalid",
      vaultId: vault.id,
      ...(sourcePath ? { sourcePath } : {}),
      canMutate: false,
      summary: { kept: 0, dismissed: 0 },
      decisions: [],
      diagnostic: INVALID_DIAGNOSTIC,
    };
  }
  const all = read.store.decisions;
  const decisions = all
    .filter(
      (record) =>
        sourcePath === undefined ||
        record.leftPath === sourcePath ||
        record.rightPath === sourcePath,
    )
    .map((record) => presentRecord(record, machine));
  return {
    status: "ready",
    vaultId: vault.id,
    ...(sourcePath ? { sourcePath } : {}),
    canMutate,
    summary: {
      kept: all.filter((record) => record.decision === "kept").length,
      dismissed: all.filter((record) => record.decision === "dismissed").length,
    },
    decisions,
  };
}

export async function setRelatedNotesCurationDecision(
  vault: VaultInfo,
  machine: MachineIndexResult,
  raw: unknown,
  cwd = process.cwd(),
  now = new Date(),
): Promise<RelatedNotesCurationMutationResponse> {
  requireWritePermission(vault);
  if (!isRecord(raw) || !hasOnlyKeys(raw, ["leftPath", "rightPath", "decision"])) {
    throw invalidDecision();
  }
  const pair = canonicalPair(raw.leftPath, raw.rightPath);
  if (raw.decision !== "kept" && raw.decision !== "dismissed") throw invalidDecision();
  const hashes = currentPairHashes(machine, pair.leftPath, pair.rightPath);
  const record: RelatedNotesCurationRecord = {
    ...pair,
    decision: raw.decision,
    decidedAt: now.toISOString(),
    leftHashAtDecision: hashes.leftHash,
    rightHashAtDecision: hashes.rightHash,
    producerAtDecision: RELATED_NOTES_PRODUCER,
    producerVersionAtDecision: RELATED_NOTES_PRODUCER_VERSION,
  };
  const file = await relatedNotesCurationPath(vault, cwd);
  await withCurationWriteLock(file, async () => {
    const read = await readStoredCuration(file, vault.id);
    if (read.status === "invalid") throw invalidStoredCuration();
    const decisions = read.store.decisions.filter(
      (candidate) =>
        pairKey(candidate.leftPath, candidate.rightPath) !== pairKey(pair.leftPath, pair.rightPath),
    );
    decisions.push(record);
    await writeStoredCuration(file, {
      ...read.store,
      decisions: decisions.sort(compareRecords),
    });
  });
  return { status: "updated", decision: presentRecord(record, machine) };
}

export async function clearRelatedNotesCurationDecision(
  vault: VaultInfo,
  raw: unknown,
  cwd = process.cwd(),
): Promise<RelatedNotesCurationMutationResponse> {
  requireWritePermission(vault);
  if (!isRecord(raw) || !hasOnlyKeys(raw, ["leftPath", "rightPath"])) throw invalidDecision();
  const pair = canonicalPair(raw.leftPath, raw.rightPath);
  const file = await relatedNotesCurationPath(vault, cwd);
  await withCurationWriteLock(file, async () => {
    const read = await readStoredCuration(file, vault.id);
    if (read.status === "invalid") throw invalidStoredCuration();
    const decisions = read.store.decisions.filter(
      (candidate) =>
        pairKey(candidate.leftPath, candidate.rightPath) !== pairKey(pair.leftPath, pair.rightPath),
    );
    if (decisions.length !== read.store.decisions.length) {
      await writeStoredCuration(file, { ...read.store, decisions });
    }
  });
  return { status: "cleared" };
}

export async function applyRelatedNotesCuration(
  vault: VaultInfo,
  machine: MachineIndexResult,
  response: RelatedNotesDerivedResponse,
  cwd = process.cwd(),
): Promise<RelatedNotesResponse> {
  const read = await readStoredCuration(await relatedNotesCurationPath(vault, cwd), vault.id);
  if (read.status === "invalid") {
    return {
      ...response,
      curation: { status: "invalid", kept: [], diagnostic: INVALID_DIAGNOSTIC },
    };
  }
  const relevant = read.store.decisions.filter(
    (record) => record.leftPath === response.sourcePath || record.rightPath === response.sourcePath,
  );
  const decidedTargets = new Set(relevant.map((record) => otherPath(record, response.sourcePath)));
  const kept = relevant
    .filter((record) => record.decision === "kept")
    .map((record) => ({
      targetPath: otherPath(record, response.sourcePath),
      decidedAt: record.decidedAt,
      freshness: freshnessFor(record, machine),
      explicitInSource: hasExplicitRelationship(
        machine.data.index,
        response.sourcePath,
        otherPath(record, response.sourcePath),
      ),
    }))
    .filter((record) => machine.data.index.notes[record.targetPath] !== undefined)
    .sort((left, right) => compareRelatedNotesCurationPaths(left.targetPath, right.targetPath));
  return {
    ...response,
    candidates: response.candidates.filter(
      (candidate) => !decidedTargets.has(candidate.targetPath),
    ),
    curation: { status: "ready", kept },
  };
}

export async function requireKeptRelatedNotesCurationDecision(
  vault: VaultInfo,
  rawLeftPath: unknown,
  rawRightPath: unknown,
  cwd = process.cwd(),
): Promise<void> {
  requireReadPermission(vault);
  const pair = canonicalPair(rawLeftPath, rawRightPath);
  const read = await readStoredCuration(await relatedNotesCurationPath(vault, cwd), vault.id);
  if (read.status === "invalid") throw invalidStoredCuration();
  const record = read.store.decisions.find(
    (candidate) =>
      pairKey(candidate.leftPath, candidate.rightPath) === pairKey(pair.leftPath, pair.rightPath),
  );
  if (record?.decision !== "kept") {
    throw new PublicApiError(409, "Only a kept relationship can be added to note metadata.", {
      code: "relationship-promotion-requires-kept",
    });
  }
}

export async function renameRelatedNotesCurationPaths(
  vault: VaultInfo,
  fromPath: string,
  toPath: string,
  kind: "file" | "folder",
  cwd = process.cwd(),
): Promise<{ changed: boolean; diagnostic?: string }> {
  const file = await relatedNotesCurationPath(vault, cwd);
  try {
    return await withCurationWriteLock(file, async () => {
      const read = await readStoredCuration(file, vault.id);
      if (read.status === "invalid") return { changed: false, diagnostic: INVALID_DIAGNOSTIC };
      let changed = false;
      const unchanged: RelatedNotesCurationRecord[] = [];
      const transformed: RelatedNotesCurationRecord[] = [];
      for (const record of read.store.decisions) {
        const nextLeft = renamedPath(record.leftPath, fromPath, toPath, kind);
        const nextRight = renamedPath(record.rightPath, fromPath, toPath, kind);
        if (nextLeft === record.leftPath && nextRight === record.rightPath) {
          unchanged.push(record);
          continue;
        }
        changed = true;
        transformed.push(recanonicalizeRecord(record, nextLeft, nextRight));
      }
      if (!changed) return { changed: false };
      const byPair = new Map<string, RelatedNotesCurationRecord>();
      for (const record of [
        ...unchanged.sort(compareRecords),
        ...transformed.sort(compareRecords),
      ]) {
        byPair.set(pairKey(record.leftPath, record.rightPath), record);
      }
      await writeStoredCuration(file, {
        ...read.store,
        decisions: [...byPair.values()].sort(compareRecords),
      });
      return { changed: true };
    });
  } catch {
    return {
      changed: false,
      diagnostic: "The source was renamed, but Related Notes curation could not be updated.",
    };
  }
}

export async function readStoredRelatedNotesCurationForTest(
  vault: Pick<VaultInfo, "id">,
  cwd = process.cwd(),
): Promise<StoredRead> {
  return readStoredCuration(await relatedNotesCurationPath(vault, cwd), vault.id);
}

async function readStoredCuration(file: string, vaultId: string): Promise<StoredRead> {
  let text: string;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > CURATION_MAX_BYTES) return { status: "invalid" };
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing", store: emptyStore(vaultId) };
    }
    return { status: "invalid" };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return isStoredCuration(parsed, vaultId)
      ? { status: "ready", store: parsed }
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

async function writeStoredCuration(file: string, store: StoredRelatedNotesCuration): Promise<void> {
  if (store.decisions.length > RELATED_NOTES_CURATION_MAX_DECISIONS) {
    throw new PublicApiError(409, "Too many Related Notes curation decisions are stored.", {
      code: "related-notes-curation-limit",
    });
  }
  const serialized = `${JSON.stringify(store, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > CURATION_MAX_BYTES) {
    throw new PublicApiError(409, "Related Notes curation storage is full.", {
      code: "related-notes-curation-limit",
    });
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "w", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function isStoredCuration(value: unknown, vaultId: string): value is StoredRelatedNotesCuration {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["kind", "version", "vaultId", "decisions"]) ||
    value.kind !== RELATED_NOTES_CURATION_KIND ||
    value.version !== RELATED_NOTES_CURATION_VERSION ||
    value.vaultId !== vaultId ||
    !Array.isArray(value.decisions) ||
    value.decisions.length > RELATED_NOTES_CURATION_MAX_DECISIONS
  ) {
    return false;
  }
  const keys = new Set<string>();
  for (const decision of value.decisions) {
    if (!isCurationRecord(decision)) return false;
    const key = pairKey(decision.leftPath, decision.rightPath);
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return value.decisions.every(
    (record, index, records) => index === 0 || compareRecords(records[index - 1], record) < 0,
  );
}

function isCurationRecord(value: unknown): value is RelatedNotesCurationRecord {
  if (!isRecord(value)) return false;
  const optional = ["producerAtDecision", "producerVersionAtDecision"];
  if (
    !hasOnlyKeys(value, [
      "leftPath",
      "rightPath",
      "decision",
      "decidedAt",
      "leftHashAtDecision",
      "rightHashAtDecision",
      ...optional,
    ]) ||
    !isCanonicalOrderedPair(value.leftPath, value.rightPath) ||
    (value.decision !== "kept" && value.decision !== "dismissed") ||
    !isIsoTimestamp(value.decidedAt) ||
    !isSha256(value.leftHashAtDecision) ||
    !isSha256(value.rightHashAtDecision) ||
    (value.producerAtDecision !== undefined &&
      (typeof value.producerAtDecision !== "string" || value.producerAtDecision.length > 128)) ||
    (value.producerVersionAtDecision !== undefined &&
      (typeof value.producerVersionAtDecision !== "number" ||
        !Number.isInteger(value.producerVersionAtDecision) ||
        value.producerVersionAtDecision < 1))
  ) {
    return false;
  }
  return true;
}

function presentRecord(
  record: RelatedNotesCurationRecord,
  machine: MachineIndexResult,
): RelatedNotesCurationPresentation {
  return {
    leftPath: record.leftPath,
    rightPath: record.rightPath,
    decision: record.decision,
    decidedAt: record.decidedAt,
    freshness: freshnessFor(record, machine),
    ...(record.producerAtDecision ? { producerAtDecision: record.producerAtDecision } : {}),
    ...(record.producerVersionAtDecision
      ? { producerVersionAtDecision: record.producerVersionAtDecision }
      : {}),
  };
}

function freshnessFor(
  record: RelatedNotesCurationRecord,
  machine: MachineIndexResult,
): RelatedNotesCurationFreshness {
  const left = currentHash(machine, record.leftPath);
  const right = currentHash(machine, record.rightPath);
  if (!left && !right) return "both-missing";
  if (!left) return "left-missing";
  if (!right) return "right-missing";
  const leftChanged = left !== record.leftHashAtDecision;
  const rightChanged = right !== record.rightHashAtDecision;
  if (leftChanged && rightChanged) return "both-changed";
  if (leftChanged) return "left-changed";
  if (rightChanged) return "right-changed";
  return "current";
}

function currentPairHashes(
  machine: MachineIndexResult,
  leftPath: string,
  rightPath: string,
): { leftHash: string; rightHash: string } {
  const leftHash = currentHash(machine, leftPath);
  const rightHash = currentHash(machine, rightPath);
  if (!leftHash || !rightHash) {
    throw new PublicApiError(404, "Curation requires two available Markdown sources.", {
      code: "related-notes-curation-source-unavailable",
    });
  }
  return { leftHash, rightHash };
}

function currentHash(machine: MachineIndexResult, sourcePath: string): string | undefined {
  if (!machine.data.index.notes[sourcePath]) return undefined;
  const source = machine.manifest.sources.find(
    (candidate) => candidate.path === sourcePath && candidate.state === "readable",
  );
  return source?.state === "readable" ? source.contentHash : undefined;
}

function canonicalPair(left: unknown, right: unknown): { leftPath: string; rightPath: string } {
  const leftPath = curationPath(left);
  const rightPath = curationPath(right);
  if (leftPath === rightPath) throw invalidDecision();
  return compareRelatedNotesCurationPaths(leftPath, rightPath) < 0
    ? { leftPath, rightPath }
    : { leftPath: rightPath, rightPath: leftPath };
}

function curationPath(value: unknown): string {
  try {
    return normalizeMarkdownFilePath(value);
  } catch {
    throw invalidDecision();
  }
}

function isCanonicalOrderedPair(left: unknown, right: unknown): boolean {
  try {
    const pair = canonicalPair(left, right);
    return pair.leftPath === left && pair.rightPath === right;
  } catch {
    return false;
  }
}

function recanonicalizeRecord(
  record: RelatedNotesCurationRecord,
  leftPath: string,
  rightPath: string,
): RelatedNotesCurationRecord {
  if (compareRelatedNotesCurationPaths(leftPath, rightPath) < 0) {
    return { ...record, leftPath, rightPath };
  }
  return {
    ...record,
    leftPath: rightPath,
    rightPath: leftPath,
    leftHashAtDecision: record.rightHashAtDecision,
    rightHashAtDecision: record.leftHashAtDecision,
  };
}

function renamedPath(
  sourcePath: string,
  fromPath: string,
  toPath: string,
  kind: "file" | "folder",
): string {
  if (kind === "file") return sourcePath === fromPath ? toPath : sourcePath;
  const prefix = `${fromPath}/`;
  return sourcePath.startsWith(prefix)
    ? `${toPath}/${sourcePath.slice(prefix.length)}`
    : sourcePath;
}

function otherPath(record: RelatedNotesCurationRecord, sourcePath: string): string {
  return record.leftPath === sourcePath ? record.rightPath : record.leftPath;
}

function emptyStore(vaultId: string): StoredRelatedNotesCuration {
  return {
    kind: RELATED_NOTES_CURATION_KIND,
    version: RELATED_NOTES_CURATION_VERSION,
    vaultId,
    decisions: [],
  };
}

function pairKey(left: string, right: string): string {
  return `${left}\0${right}`;
}

function compareRecords(
  left: RelatedNotesCurationRecord,
  right: RelatedNotesCurationRecord,
): number {
  return (
    compareRelatedNotesCurationPaths(left.leftPath, right.leftPath) ||
    compareRelatedNotesCurationPaths(left.rightPath, right.rightPath)
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function requireReadPermission(vault: VaultInfo): void {
  if (!vault.permissions.readIndex) {
    throw new PublicApiError(403, "Related Notes curation is not available.", {
      code: "related-notes-curation-not-permitted",
    });
  }
}

function requireWritePermission(vault: VaultInfo): void {
  requireReadPermission(vault);
  if (!vault.permissions.writeContent) {
    throw new PublicApiError(403, "Related Notes curation cannot be changed.", {
      code: "related-notes-curation-not-writable",
    });
  }
}

function invalidDecision(): PublicApiError {
  return new PublicApiError(400, "Related Notes curation decision is invalid.", {
    code: "invalid-related-notes-curation",
  });
}

function invalidStoredCuration(): PublicApiError {
  return new PublicApiError(409, "Stored Related Notes curation must be repaired before editing.", {
    code: "related-notes-curation-store-invalid",
  });
}

async function withCurationWriteLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const previous = curationWriteLocks.get(file) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  curationWriteLocks.set(file, tail);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (curationWriteLocks.get(file) === tail) curationWriteLocks.delete(file);
  }
}
