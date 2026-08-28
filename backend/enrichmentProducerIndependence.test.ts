import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { EmbeddingBatchResult, EmbeddingProvider } from "./embeddingProvider.js";
import { EmbeddingProviderError } from "./embeddingProvider.js";
import { writeEnrichmentPreferences } from "./enrichmentPreferences.js";
import { getMachineIndexResult } from "./indexCache.js";
import { getRelatedNotes } from "./relatedNotesCache.js";
import { semanticProviderStatusForPreference } from "./semanticProviderStatus.js";
import { embedScopedSemanticSources, resolveSemanticScope } from "./semanticScope.js";
import { makeTestTempDir } from "./testTemp.js";
import type { VaultInfo } from "./types.js";
import { namedRelatedNotesPreference } from "../src/lib/vault/enrichmentPreferences.js";
import type { EmbeddingProviderIdentity } from "../src/lib/vault/semanticContracts.js";

class TruthTableProvider implements EmbeddingProvider {
  embedCalls = 0;
  constructor(private readonly unavailable: boolean) {}
  async listModels() {
    if (this.unavailable) {
      throw new EmbeddingProviderError("provider-unreachable", "Provider is unavailable.");
    }
    return [{ name: "embed", digest: "a".repeat(64) }];
  }
  async getIdentity(_model: string): Promise<EmbeddingProviderIdentity> {
    throw new Error("unused");
  }
  async embed(model: string): Promise<EmbeddingBatchResult> {
    this.embedCalls += 1;
    return {
      identity: {
        provider: "ollama",
        endpoint: "http://127.0.0.1:11434",
        model,
        dimensions: 2,
      },
      vectors: [[1, 0]],
    };
  }
}

async function fixture(t: TestContext): Promise<{ cwd: string; vault: VaultInfo }> {
  const cwd = await makeTestTempDir(t, "arepo-enrichment-independence-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-enrichment-independence-vault-");
  await fs.writeFile(path.join(rootPath, "a.md"), "# Alpha\ncanonical stale update conflict");
  await fs.writeFile(path.join(rootPath, "b.md"), "# Beta\ncanonical stale update conflict");
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  const vault: VaultInfo = {
    id: "notes",
    displayName: "Notes",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
  };
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: { nodeId: "local", displayName: "Local", mode: "local", apiVersion: 1 },
      appDataDir: "./app-data",
      vaults: [vault],
    }),
  );
  return { cwd, vault };
}

test("deterministic and semantic producers obey the complete independent-consent truth table", async (t) => {
  const { cwd, vault } = await fixture(t);
  const cases = [
    [false, false, false, [] as string[], "disabled", "disabled"],
    [true, false, false, [] as string[], "ready", "disabled"],
    [false, true, false, [] as string[], "disabled", "available"],
    [false, true, true, ["a.md", "b.md"], "disabled", "provider-unreachable"],
    [true, true, false, [] as string[], "ready", "available"],
    [true, true, true, ["a.md", "b.md"], "ready", "provider-unreachable"],
  ] as const;
  for (const [
    deterministic,
    semantic,
    unavailable,
    selectedPaths,
    relatedStatus,
    semanticStatus,
  ] of cases) {
    const semanticPreference = {
      enabled: semantic,
      provider: "ollama" as const,
      endpoint: "http://127.0.0.1:11434",
      model: semantic ? "embed" : "",
      scope: { mode: "selected" as const, selectedPaths: [...selectedPaths] },
    };
    await writeEnrichmentPreferences(
      vault,
      {
        relatedNotes: namedRelatedNotesPreference("balanced", deterministic),
        semantic: semanticPreference,
      },
      cwd,
    );
    const related = await getRelatedNotes(
      vault,
      "a.md",
      () => getMachineIndexResult(vault, cwd),
      cwd,
    );
    const scope = await resolveSemanticScope(vault, semanticPreference, cwd);
    const providerImplementation = new TruthTableProvider(unavailable);
    if (scope.authorizedPaths.length === 0) {
      assert.equal(
        await embedScopedSemanticSources(
          providerImplementation,
          semanticPreference.model || "embed",
          scope,
          [],
        ),
        null,
      );
      assert.equal(providerImplementation.embedCalls, 0);
    }
    const provider = await semanticProviderStatusForPreference(
      semanticPreference,
      providerImplementation,
    );
    assert.equal(related.data.status, relatedStatus);
    assert.equal(provider.status, semanticStatus);
    assert.equal(scope.effectivePaths.length, selectedPaths.length);
  }
});
