import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getAppDataDir } from "./config.js";
import { PublicApiError } from "./publicApiError.js";
import {
  canonicalizeLegacyV2SemanticPreference,
  canonicalizeSemanticPreference,
  renameSemanticScopePaths,
} from "./semanticPreference.js";
import type { VaultInfo } from "./types.js";
import {
  defaultEnrichmentPreferences,
  isEnrichmentPreferences,
  isRelatedNotesPreference,
  type EnrichmentPreferences,
  type EnrichmentPreferencesResponse,
  type RelatedNotesPreference,
} from "../src/lib/vault/enrichmentPreferences.js";
import {
  defaultSemanticPreference,
  type SemanticPreference,
} from "../src/lib/vault/semanticContracts.js";

const preferenceWriteLocks = new Map<string, Promise<void>>();
const INVALID_DIAGNOSTIC =
  "Invalid stored enrichment settings were ignored; affected enrichment remains off.";
const ENRICHMENT_PREFERENCES_MAX_BYTES = 16 * 1024 * 1024;

export async function enrichmentPreferencesPath(
  vault: Pick<VaultInfo, "id">,
  cwd = process.cwd(),
): Promise<string> {
  return path.join(await getAppDataDir(cwd), "preferences", `${vault.id}.enrichment.json`);
}

export async function readEnrichmentPreferences(
  vault: Pick<VaultInfo, "id">,
  cwd = process.cwd(),
): Promise<EnrichmentPreferencesResponse> {
  const fallback = defaultEnrichmentPreferences(vault.id);
  const file = await enrichmentPreferencesPath(vault, cwd);
  let parsed: unknown;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > ENRICHMENT_PREFERENCES_MAX_BYTES) throw new Error("invalid");
    parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "ready", storageStatus: "default", preferences: fallback };
    }
    return {
      status: "ready",
      storageStatus: "invalid",
      preferences: fallback,
      diagnostic: INVALID_DIAGNOSTIC,
    };
  }
  if (isEnrichmentPreferences(parsed, vault.id)) {
    return { status: "ready", storageStatus: "stored", preferences: parsed };
  }
  const upgraded = upgradeLegacyPreferences(parsed, vault.id);
  if (upgraded) {
    return { status: "ready", storageStatus: "stored", preferences: upgraded };
  }
  const upgradedV2 = upgradeVersion2Preferences(parsed, vault.id);
  if (upgradedV2) {
    return { status: "ready", storageStatus: "stored", preferences: upgradedV2 };
  }
  const recovered = recoverWithSemanticDisabled(parsed, vault.id);
  if (recovered) {
    return {
      status: "ready",
      storageStatus: "invalid",
      preferences: recovered,
      diagnostic: INVALID_DIAGNOSTIC,
    };
  }
  return {
    status: "ready",
    storageStatus: "invalid",
    preferences: fallback,
    diagnostic: INVALID_DIAGNOSTIC,
  };
}

export async function writeRelatedNotesPreference(
  vault: Pick<VaultInfo, "id">,
  rawPreference: unknown,
  cwd = process.cwd(),
): Promise<EnrichmentPreferencesResponse> {
  if (!isRelatedNotesPreference(rawPreference)) {
    throw new PublicApiError(400, "Related Notes settings are invalid.", {
      code: "invalid-related-notes-settings",
    });
  }
  return writeEnrichmentPreferences(
    vault,
    { relatedNotes: rawPreference as RelatedNotesPreference },
    cwd,
  );
}

export async function writeSemanticPreference(
  vault: Pick<VaultInfo, "id">,
  rawPreference: unknown,
  cwd = process.cwd(),
): Promise<EnrichmentPreferencesResponse> {
  const preference = canonicalizeSemanticPreference(rawPreference);
  if (!preference) {
    throw new PublicApiError(400, "Semantic Similarity settings are invalid.", {
      code: "invalid-semantic-settings",
    });
  }
  return writeEnrichmentPreferences(vault, { semantic: preference }, cwd);
}

export async function writeEnrichmentPreferences(
  vault: Pick<VaultInfo, "id">,
  raw: unknown,
  cwd = process.cwd(),
): Promise<EnrichmentPreferencesResponse> {
  if (!isRecord(raw) || !hasOnlyKeys(raw, ["relatedNotes", "semantic"])) {
    throw new PublicApiError(400, "Enrichment settings are invalid.", {
      code: "invalid-enrichment-settings",
    });
  }
  if (raw.relatedNotes !== undefined && !isRelatedNotesPreference(raw.relatedNotes)) {
    throw new PublicApiError(400, "Related Notes settings are invalid.", {
      code: "invalid-related-notes-settings",
    });
  }
  const semantic =
    raw.semantic === undefined ? undefined : canonicalizeSemanticPreference(raw.semantic);
  if (raw.semantic !== undefined && !semantic) {
    throw new PublicApiError(400, "Semantic Similarity settings are invalid.", {
      code: "invalid-semantic-settings",
    });
  }
  if (raw.relatedNotes === undefined && raw.semantic === undefined) {
    throw new PublicApiError(400, "Enrichment settings are invalid.", {
      code: "invalid-enrichment-settings",
    });
  }
  const file = await enrichmentPreferencesPath(vault, cwd);
  return withPreferenceWriteLock(file, async () => {
    const current = await readEnrichmentPreferences(vault, cwd);
    const preferences: EnrichmentPreferences = {
      ...current.preferences,
      producers: {
        relatedNotes: (raw.relatedNotes ??
          current.preferences.producers.relatedNotes) as RelatedNotesPreference,
        semantic: semantic ?? current.preferences.producers.semantic,
      },
    };
    await writePreferencesFile(file, preferences);
    return { status: "ready", storageStatus: "stored", preferences };
  });
}

export async function renameSemanticPreferencePaths(
  vault: Pick<VaultInfo, "id">,
  fromPath: string,
  toPath: string,
  kind: "file" | "folder",
  cwd = process.cwd(),
): Promise<{ changed: boolean; diagnostic?: string }> {
  const file = await enrichmentPreferencesPath(vault, cwd);
  try {
    return await withPreferenceWriteLock(file, async () => {
      const current = await readEnrichmentPreferences(vault, cwd);
      const rewritten = renameSemanticScopePaths(
        current.preferences.producers.semantic.scope,
        fromPath,
        toPath,
        kind,
      );
      if (!rewritten.changed) return { changed: false };
      const preferences: EnrichmentPreferences = {
        ...current.preferences,
        producers: {
          ...current.preferences.producers,
          semantic: {
            ...current.preferences.producers.semantic,
            scope: rewritten.scope,
          },
        },
      };
      await writePreferencesFile(file, preferences);
      return { changed: true };
    });
  } catch {
    return {
      changed: false,
      diagnostic:
        "The source was renamed, but Semantic Similarity selections could not be updated.",
    };
  }
}

function upgradeLegacyPreferences(value: unknown, vaultId: string): EnrichmentPreferences | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "version", "vaultId", "producers"]) ||
    value.kind !== "arepo.enrichmentPreferences" ||
    value.version !== 1 ||
    value.vaultId !== vaultId ||
    !isRecord(value.producers) ||
    !hasExactKeys(value.producers, ["relatedNotes"]) ||
    !isRelatedNotesPreference(value.producers.relatedNotes)
  ) {
    return null;
  }
  return {
    ...defaultEnrichmentPreferences(vaultId),
    producers: {
      relatedNotes: value.producers.relatedNotes,
      semantic: defaultSemanticPreference(),
    },
  };
}

function upgradeVersion2Preferences(value: unknown, vaultId: string): EnrichmentPreferences | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "version", "vaultId", "producers"]) ||
    value.kind !== "arepo.enrichmentPreferences" ||
    value.version !== 2 ||
    value.vaultId !== vaultId ||
    !isRecord(value.producers) ||
    !hasExactKeys(value.producers, ["relatedNotes", "semantic"]) ||
    !isRelatedNotesPreference(value.producers.relatedNotes)
  ) {
    return null;
  }
  const semantic = canonicalizeLegacyV2SemanticPreference(value.producers.semantic);
  if (!semantic) return null;
  return {
    ...defaultEnrichmentPreferences(vaultId),
    producers: {
      relatedNotes: value.producers.relatedNotes,
      semantic,
    },
  };
}

function recoverWithSemanticDisabled(
  value: unknown,
  vaultId: string,
): EnrichmentPreferences | null {
  if (
    !isRecord(value) ||
    value.kind !== "arepo.enrichmentPreferences" ||
    (value.version !== 2 && value.version !== 3) ||
    value.vaultId !== vaultId ||
    !isRecord(value.producers) ||
    !isRelatedNotesPreference(value.producers.relatedNotes) ||
    (value.version === 2
      ? canonicalizeLegacyV2SemanticPreference(value.producers.semantic) !== null
      : canonicalizeSemanticPreference(value.producers.semantic) !== null)
  ) {
    return null;
  }
  return {
    ...defaultEnrichmentPreferences(vaultId),
    producers: {
      relatedNotes: value.producers.relatedNotes,
      semantic: defaultSemanticPreference(),
    },
  };
}

async function writePreferencesFile(
  file: string,
  preferences: EnrichmentPreferences,
): Promise<void> {
  const serialized = `${JSON.stringify(preferences, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > ENRICHMENT_PREFERENCES_MAX_BYTES) {
    throw new PublicApiError(409, "Enrichment settings exceed the storage limit.", {
      code: "enrichment-settings-limit",
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
    await fs.unlink(temporary).catch((unlinkError: NodeJS.ErrnoException) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && hasOnlyKeys(record, keys);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

async function withPreferenceWriteLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const previous = preferenceWriteLocks.get(file) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  preferenceWriteLocks.set(file, tail);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (preferenceWriteLocks.get(file) === tail) preferenceWriteLocks.delete(file);
  }
}
