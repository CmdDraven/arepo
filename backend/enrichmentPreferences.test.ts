import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  enrichmentPreferencesPath,
  readEnrichmentPreferences,
  writeRelatedNotesPreference,
} from "./enrichmentPreferences.js";
import { makeTestTempDir } from "./testTemp.js";
import type { VaultInfo } from "./types.js";
import {
  namedRelatedNotesPreference,
  type NamedRelatedNotesPreset,
} from "../src/lib/vault/enrichmentPreferences.js";

async function fixture(t: TestContext): Promise<{ cwd: string; vault: VaultInfo }> {
  const cwd = await makeTestTempDir(t, "arepo-enrichment-preferences-");
  const rootPath = await makeTestTempDir(t, "arepo-enrichment-vault-");
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: { nodeId: "local", displayName: "Local", mode: "local", apiVersion: 1 },
      appDataDir: "./app-data",
      vaults: [],
    }),
  );
  return {
    cwd,
    vault: {
      id: "notes",
      displayName: "Notes",
      rootPath,
      permissions: {
        readIndex: true,
        readContent: true,
        writeContent: true,
        deleteFiles: false,
      },
    },
  };
}

async function storePreset(
  vault: VaultInfo,
  cwd: string,
  preset: NamedRelatedNotesPreset,
  enabled = true,
) {
  return writeRelatedNotesPreference(vault, namedRelatedNotesPreference(preset, enabled), cwd);
}

test("missing preferences are disabled and do not create storage", async (t) => {
  const { cwd, vault } = await fixture(t);
  const response = await readEnrichmentPreferences(vault, cwd);
  assert.equal(response.storageStatus, "default");
  assert.equal(response.preferences.producers.relatedNotes.enabled, false);
  const file = await enrichmentPreferencesPath(vault, cwd);
  await assert.rejects(() => fs.access(file), {
    code: "ENOENT",
  });
});

test("malformed, unknown-version, mismatched-vault, and unreadable-shaped state fail closed", async (t) => {
  const { cwd, vault } = await fixture(t);
  const file = await enrichmentPreferencesPath(vault, cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (const value of [
    "not json",
    JSON.stringify({ kind: "arepo.enrichmentPreferences", version: 999 }),
    JSON.stringify({
      kind: "arepo.enrichmentPreferences",
      version: 1,
      vaultId: "other",
      producers: { relatedNotes: namedRelatedNotesPreference("balanced", true) },
    }),
  ]) {
    await fs.writeFile(file, value, "utf8");
    const response = await readEnrichmentPreferences(vault, cwd);
    assert.equal(response.storageStatus, "invalid");
    assert.equal(response.preferences.producers.relatedNotes.enabled, false);
    assert.equal(JSON.stringify(response).includes(file), false);
  }
  await fs.rm(file);
  await fs.mkdir(file);
  const unreadable = await readEnrichmentPreferences(vault, cwd);
  assert.equal(unreadable.storageStatus, "invalid");
  assert.equal(unreadable.preferences.producers.relatedNotes.enabled, false);
});

test("valid preferences survive a fresh read and remain isolated by vault ID", async (t) => {
  const { cwd, vault } = await fixture(t);
  const other = { ...vault, id: "other" };
  await storePreset(vault, cwd, "conservative");
  await storePreset(other, cwd, "exploratory", false);
  assert.equal(
    (await readEnrichmentPreferences(vault, cwd)).preferences.producers.relatedNotes.preset,
    "conservative",
  );
  const otherRead = await readEnrichmentPreferences(other, cwd);
  assert.equal(otherRead.preferences.producers.relatedNotes.preset, "exploratory");
  assert.equal(otherRead.preferences.producers.relatedNotes.enabled, false);
  assert.notEqual(
    await enrichmentPreferencesPath(vault, cwd),
    await enrichmentPreferencesPath(other, cwd),
  );
});

test("rejected updates leave the prior valid preference active", async (t) => {
  const { cwd, vault } = await fixture(t);
  await storePreset(vault, cwd, "conservative");
  await assert.rejects(
    () => writeRelatedNotesPreference(vault, { enabled: true, preset: "future" }, cwd),
    (error: { code?: string }) => error.code === "invalid-related-notes-settings",
  );
  assert.equal(
    (await readEnrichmentPreferences(vault, cwd)).preferences.producers.relatedNotes.preset,
    "conservative",
  );
});

test("atomic persistence failure leaves the previous stored preference active", async (t) => {
  const { cwd, vault } = await fixture(t);
  await storePreset(vault, cwd, "balanced");
  const file = await enrichmentPreferencesPath(vault, cwd);
  const originalRename = fs.rename;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (to === file) {
      throw Object.assign(new Error("simulated atomic publication failure"), { code: "EIO" });
    }
    return originalRename(from, to);
  }) as typeof fs.rename;
  await assert.rejects(() => storePreset(vault, cwd, "conservative"), { code: "EIO" });
  fs.rename = originalRename;
  assert.equal(
    (await readEnrichmentPreferences(vault, cwd)).preferences.producers.relatedNotes.preset,
    "balanced",
  );
});
