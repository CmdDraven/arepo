import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getAppDataDir } from "./config.js";
import { PublicApiError } from "./publicApiError.js";
import type { VaultInfo } from "./types.js";
import {
  defaultEnrichmentPreferences,
  isEnrichmentPreferences,
  isRelatedNotesPreference,
  type EnrichmentPreferences,
  type EnrichmentPreferencesResponse,
  type RelatedNotesPreference,
} from "../src/lib/vault/enrichmentPreferences.js";

const preferenceWriteLocks = new Map<string, Promise<void>>();
const INVALID_DIAGNOSTIC =
  "Stored enrichment preferences were invalid or unreadable; enrichment remains off.";

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
  if (!isEnrichmentPreferences(parsed, vault.id)) {
    return {
      status: "ready",
      storageStatus: "invalid",
      preferences: fallback,
      diagnostic: INVALID_DIAGNOSTIC,
    };
  }
  return { status: "ready", storageStatus: "stored", preferences: parsed };
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
  const preferences: EnrichmentPreferences = {
    ...defaultEnrichmentPreferences(vault.id),
    producers: { relatedNotes: rawPreference as RelatedNotesPreference },
  };
  const file = await enrichmentPreferencesPath(vault, cwd);
  await withPreferenceWriteLock(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, "w", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(preferences, null, 2)}\n`, "utf8");
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
  });
  return { status: "ready", storageStatus: "stored", preferences };
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
