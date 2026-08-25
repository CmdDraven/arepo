import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getAppDataDir } from "./config.js";
import {
  buildVaultIndexFromInputs,
  captureStructuralIndexInputs,
  type StructuralIndexInputManifest,
} from "./vaultFs.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";

export const MACHINE_INDEX_VERSION = 3;
export const STRUCTURAL_INDEX_DERIVATION_VERSION = 1;
const OWNED_MACHINE_INDEX_VERSIONS = new Set([1, 2, MACHINE_INDEX_VERSION]);
const indexOperationLocks = new Map<string, Promise<void>>();

export type StoredMachineIndex = {
  kind: "arepo.machineIndex";
  version: 3;
  derivationVersion: 1;
  generatedAt: string;
  vault: {
    id: string;
    displayName: string;
    rootPathHash: string;
  };
  manifest: StructuralIndexInputManifest;
  data: VaultIndexResponse;
};

export type MachineIndexResult = {
  data: VaultIndexResponse;
  cacheStatus: "hit" | "rebuilt";
};

export type GeneratedDataRemoval = {
  deletedPaths: string[];
  diagnostics: string[];
};

export async function getMachineIndex(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<VaultIndexResponse> {
  return (await getMachineIndexResult(vault, cwd)).data;
}

export async function getMachineIndexResult(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<MachineIndexResult> {
  const file = await machineIndexPath(vault, cwd);
  return withIndexLock(indexOperationLocks, file, async () => {
    const inputs = await captureStructuralIndexInputs(vault);
    const stored = await readStoredMachineIndex(file);
    const expectedRootHash = await vaultRootHash(vault);
    if (
      stored &&
      stored.derivationVersion === STRUCTURAL_INDEX_DERIVATION_VERSION &&
      stored.vault.id === vault.id &&
      stored.vault.rootPathHash === expectedRootHash &&
      manifestsEqual(stored.manifest, inputs.manifest)
    ) {
      return { data: stored.data, cacheStatus: "hit" };
    }

    const data = toPersistedVaultIndexResponse(buildVaultIndexFromInputs(inputs));
    await writeMachineIndexUnlocked(file, vault, inputs.manifest, data, expectedRootHash);
    return { data, cacheStatus: "rebuilt" };
  });
}

export async function rebuildMachineIndex(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<VaultIndexResponse> {
  const file = await machineIndexPath(vault, cwd);
  return withIndexLock(indexOperationLocks, file, async () => {
    const inputs = await captureStructuralIndexInputs(vault);
    const data = toPersistedVaultIndexResponse(buildVaultIndexFromInputs(inputs));
    await writeMachineIndexUnlocked(file, vault, inputs.manifest, data);
    return data;
  });
}

async function writeMachineIndexUnlocked(
  file: string,
  vault: VaultInfo,
  manifest: StructuralIndexInputManifest,
  data: VaultIndexResponse,
  rootPathHash?: string,
): Promise<void> {
  const stored: StoredMachineIndex = {
    kind: "arepo.machineIndex",
    version: MACHINE_INDEX_VERSION,
    derivationVersion: STRUCTURAL_INDEX_DERIVATION_VERSION,
    generatedAt: new Date().toISOString(),
    vault: {
      id: vault.id,
      displayName: vault.displayName,
      rootPathHash: rootPathHash ?? (await vaultRootHash(vault)),
    },
    manifest,
    data,
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  try {
    await writeTempFileForRename(tmp, `${JSON.stringify(stored, null, 2)}\n`);
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.unlink(tmp).catch((unlinkError: NodeJS.ErrnoException) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}

async function readStoredMachineIndex(file: string): Promise<StoredMachineIndex | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredMachineIndex(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function manifestsEqual(
  stored: StructuralIndexInputManifest,
  current: StructuralIndexInputManifest,
): boolean {
  return JSON.stringify(stored) === JSON.stringify(current);
}

function toPersistedVaultIndexResponse(data: VaultIndexResponse): VaultIndexResponse {
  return JSON.parse(JSON.stringify(data)) as VaultIndexResponse;
}

function isStoredMachineIndex(value: unknown): value is StoredMachineIndex {
  if (!isRecord(value)) return false;
  return (
    value.kind === "arepo.machineIndex" &&
    value.version === MACHINE_INDEX_VERSION &&
    typeof value.derivationVersion === "number" &&
    typeof value.generatedAt === "string" &&
    isRecord(value.vault) &&
    typeof value.vault.id === "string" &&
    typeof value.vault.displayName === "string" &&
    typeof value.vault.rootPathHash === "string" &&
    isStructuralIndexManifest(value.manifest) &&
    isVaultIndexResponse(value.data)
  );
}

function isStructuralIndexManifest(value: unknown): value is StructuralIndexInputManifest {
  if (!isRecord(value) || !isRecord(value.scope) || !isRecord(value.scope.markdown)) return false;
  const { minDepth, maxDepth } = value.scope.markdown;
  if (
    !Number.isInteger(minDepth) ||
    (minDepth as number) < 0 ||
    (maxDepth !== null &&
      (!Number.isInteger(maxDepth) || (maxDepth as number) < (minDepth as number))) ||
    !Array.isArray(value.sources)
  ) {
    return false;
  }
  let previousPath: string | undefined;
  for (const source of value.sources) {
    if (!isRecord(source) || typeof source.path !== "string" || !source.path) return false;
    if (path.isAbsolute(source.path) || source.path.includes("\\")) return false;
    if (previousPath !== undefined && previousPath.localeCompare(source.path) >= 0) return false;
    previousPath = source.path;
    if (source.state === "readable") {
      if (!/^[a-f0-9]{64}$/.test(String(source.contentHash))) return false;
    } else if (source.state !== "unavailable" && source.state !== "excluded") {
      return false;
    }
  }
  return true;
}

function isVaultIndexResponse(value: unknown): value is VaultIndexResponse {
  if (!isRecord(value) || !isRecord(value.index) || !Array.isArray(value.issues)) return false;
  const index = value.index;
  if (
    !isRecord(index.notes) ||
    !isStringRecord(index.bySlug) ||
    !isStringArrayRecord(index.duplicateSlugs) ||
    !isStringRecord(index.byId) ||
    !isStringArrayRecord(index.duplicateIds) ||
    !isStringRecord(index.excludedBySlug) ||
    !isStringArrayRecord(index.duplicateExcludedSlugs) ||
    !isRecord(index.outgoingLinks) ||
    !isRecord(index.backlinks)
  ) {
    return false;
  }
  if (
    !isStringArray(index.excludedPaths) ||
    !Array.isArray(index.brokenLinks) ||
    !isStringArray(index.orphanNotes)
  ) {
    return false;
  }
  for (const note of Object.values(index.notes as Record<string, unknown>)) {
    if (!isRecord(note) || !isRecord(note.frontmatter)) return false;
    if (
      typeof note.path !== "string" ||
      typeof note.slug !== "string" ||
      typeof note.title !== "string" ||
      !isHeadingArray(note.headings) ||
      !isStringArray(note.anchors) ||
      !Array.isArray(note.wikilinks) ||
      !note.wikilinks.every(isWikiLink) ||
      !isStringArray(note.tags)
    ) {
      return false;
    }
  }
  for (const links of Object.values(index.outgoingLinks)) {
    if (!Array.isArray(links) || !links.every(isOutgoingLink)) return false;
  }
  for (const links of Object.values(index.backlinks)) {
    if (!Array.isArray(links) || !links.every(isBacklink)) return false;
  }
  if (!index.brokenLinks.every(isBrokenLink)) return false;
  return value.issues.every(
    (issue) =>
      isRecord(issue) &&
      typeof issue.kind === "string" &&
      typeof issue.path === "string" &&
      typeof issue.message === "string" &&
      (issue.severity === "warning" || issue.severity === "error"),
  );
}

function isWikiLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.target === "string" &&
    typeof value.raw === "string" &&
    isOptionalString(value.anchor) &&
    isOptionalString(value.alias)
  );
}

function isOutgoingLink(value: unknown): boolean {
  return (
    isWikiLink(value) &&
    isRecord(value) &&
    isOptionalString(value.targetPath) &&
    typeof value.status === "string" &&
    typeof value.broken === "boolean" &&
    (value.targetPaths === undefined || isStringArray(value.targetPaths))
  );
}

function isBacklink(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.fromPath === "string" &&
    isOptionalString(value.anchor) &&
    isOptionalString(value.alias)
  );
}

function isBrokenLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.fromPath === "string" &&
    typeof value.target === "string" &&
    typeof value.raw === "string" &&
    typeof value.status === "string" &&
    isOptionalString(value.anchor) &&
    isOptionalString(value.targetPath)
  );
}

function isHeadingArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (heading) =>
        isRecord(heading) &&
        typeof heading.level === "number" &&
        typeof heading.text === "string" &&
        typeof heading.anchor === "string" &&
        typeof heading.explicit === "boolean",
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isStringArrayRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function machineIndexPath(vault: VaultInfo, cwd = process.cwd()): Promise<string> {
  const appDataDir = await getAppDataDir(cwd);
  return path.join(
    appDataDir,
    "indexes",
    `${safeVaultKey(vault.id)}-${await vaultRootHash(vault)}.json`,
  );
}

export async function removeMachineIndexIfOwned(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<GeneratedDataRemoval> {
  const file = await machineIndexPath(vault, cwd);
  const indexesDir = path.join(await getAppDataDir(cwd), "indexes");
  if (!isPathInside(indexesDir, file)) {
    return {
      deletedPaths: [],
      diagnostics: [
        `Generated index path was not removed because it is outside AREPO app-data indexes: ${file}`,
      ],
    };
  }

  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return { deletedPaths: [], diagnostics: [] };
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return {
      deletedPaths: [],
      diagnostics: [
        `Generated index path was not removed because it is not a regular AREPO-owned file: ${file}`,
      ],
    };
  }

  const raw = await fs.readFile(file, "utf8");
  let stored: { kind?: unknown; version?: unknown; vault?: Record<string, unknown> };
  try {
    stored = JSON.parse(raw) as typeof stored;
  } catch {
    return {
      deletedPaths: [],
      diagnostics: [
        `Generated index path was not removed because its AREPO ownership marker could not be parsed: ${file}`,
      ],
    };
  }

  const expectedRootHash = await vaultRootHash(vault);
  if (
    stored.kind !== "arepo.machineIndex" ||
    typeof stored.version !== "number" ||
    !OWNED_MACHINE_INDEX_VERSIONS.has(stored.version) ||
    stored.vault?.id !== vault.id ||
    stored.vault?.rootPathHash !== expectedRootHash
  ) {
    return {
      deletedPaths: [],
      diagnostics: [
        `Generated index path was not removed because it could not be verified as AREPO-owned data for vault ${vault.id}: ${file}`,
      ],
    };
  }

  await fs.unlink(file);
  return { deletedPaths: [file], diagnostics: [] };
}

export async function vaultRootHash(vault: VaultInfo): Promise<string> {
  const root = await fs.realpath(vault.rootPath).catch(() => path.resolve(vault.rootPath));
  return crypto.createHash("sha256").update(root, "utf8").digest("hex").slice(0, 16);
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeVaultKey(vaultId: string): string {
  return vaultId.replace(/[^a-zA-Z0-9_-]/g, "-") || "vault";
}

async function writeTempFileForRename(file: string, content: string): Promise<void> {
  const handle = await fs.open(file, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function withIndexLock<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  locks.set(key, queued);
  await previous.catch(() => undefined);

  try {
    return await work();
  } finally {
    releaseCurrent();
    if (locks.get(key) === queued) locks.delete(key);
  }
}
