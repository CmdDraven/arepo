import test from "node:test";
import assert from "node:assert/strict";
import type { EmbeddingBatchResult, EmbeddingProvider } from "./embeddingProvider.js";
import { EmbeddingProviderError } from "./embeddingProvider.js";
import {
  semanticProviderDiscoveryStatusForPreference,
  semanticProviderStatusForPreference,
  testSemanticProviderConnection,
} from "./semanticProviderStatus.js";
import { OLLAMA_CAPABILITY_PROBE_TEXT } from "./ollamaEmbeddingProvider.js";
import { defaultSemanticPreference } from "../src/lib/vault/semanticContracts.js";
import type { EmbeddingProviderIdentity } from "../src/lib/vault/semanticContracts.js";

class FakeProvider implements EmbeddingProvider {
  calls: string[] = [];
  models = [{ name: "embed", digest: "d".repeat(64) }];
  failure?: EmbeddingProviderError;
  embedFailure?: EmbeddingProviderError;
  async listModels() {
    this.calls.push("models");
    if (this.failure) throw this.failure;
    return this.models;
  }
  async getIdentity(_model: string): Promise<EmbeddingProviderIdentity> {
    throw new Error("unused");
  }
  async embed(model: string, texts: string[]): Promise<EmbeddingBatchResult> {
    this.calls.push(`embed:${model}:${texts.join("|")}`);
    if (this.embedFailure) throw this.embedFailure;
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

const configured = {
  enabled: true,
  provider: "ollama" as const,
  endpoint: "http://127.0.0.1:11434",
  model: "embed",
  scope: { mode: "selected" as const, selectedPaths: [] },
};

test("disabled semantic status performs no provider discovery or inference", async () => {
  const provider = new FakeProvider();
  const status = await semanticProviderStatusForPreference(defaultSemanticPreference(), provider);
  assert.equal(status.status, "disabled");
  assert.deepEqual(provider.calls, []);
});

test("ordinary provider status discovers models without sending the capability probe", async () => {
  const provider = new FakeProvider();
  const status = await semanticProviderDiscoveryStatusForPreference(configured, provider);
  assert.equal(status.status, "model-installed");
  assert.deepEqual(provider.calls, ["models"]);
});

test("provider status distinguishes configuration, discovery, capability, and availability", async () => {
  const noModelProvider = new FakeProvider();
  const noModel = await semanticProviderStatusForPreference(
    { ...configured, model: "" },
    noModelProvider,
  );
  assert.equal(noModel.status, "not-configured");
  assert.deepEqual(noModel.models, noModelProvider.models);

  const missingProvider = new FakeProvider();
  const missing = await semanticProviderStatusForPreference(
    { ...configured, model: "other" },
    missingProvider,
  );
  assert.equal(missing.status, "model-not-found");
  assert.deepEqual(missingProvider.calls, ["models"]);

  const availableProvider = new FakeProvider();
  const available = await semanticProviderStatusForPreference(configured, availableProvider);
  assert.equal(available.status, "available");
  assert.deepEqual(availableProvider.calls, [
    "models",
    `embed:embed:${OLLAMA_CAPABILITY_PROBE_TEXT}`,
  ]);
  assert.equal(available.status === "available" && available.identity.modelDigest, "d".repeat(64));
  assert.equal(JSON.stringify(available).includes("vectors"), false);
});

test("provider failures stay semantic-only and expose bounded diagnostics", async () => {
  for (const kind of [
    "provider-unreachable",
    "model-not-embedding-capable",
    "invalid-provider-response",
    "temporarily-unavailable",
  ] as const) {
    const provider = new FakeProvider();
    provider.failure = new EmbeddingProviderError(
      kind,
      `EACCES /private/example/secret.txt ${"x".repeat(500)}`,
    );
    const status = await semanticProviderStatusForPreference(configured, provider);
    assert.equal(status.status, kind);
    assert.equal(status.enabled, true);
    assert.equal(JSON.stringify(status).includes("/private"), false);
    assert.ok("diagnostic" in status && status.diagnostic.length <= 256);
  }
});

test("capability-probe failures are classified after successful model discovery", async () => {
  const provider = new FakeProvider();
  provider.embedFailure = new EmbeddingProviderError(
    "model-not-embedding-capable",
    "raw provider body /private/example/secret.txt",
  );
  const status = await semanticProviderStatusForPreference(configured, provider);
  assert.equal(status.status, "model-not-embedding-capable");
  assert.deepEqual(provider.calls, ["models", `embed:embed:${OLLAMA_CAPABILITY_PROBE_TEXT}`]);
  assert.equal(JSON.stringify(status).includes("private"), false);
  assert.equal(JSON.stringify(status).includes("vectors"), false);
});

test("test-connection input is exact and rejects remote endpoints before provider traffic", async () => {
  await assert.rejects(
    () =>
      testSemanticProviderConnection({
        semantic: { ...configured, endpoint: "http://192.168.1.5:11434" },
      }),
    (error: { code?: string; message?: string }) =>
      error.code === "invalid-semantic-provider-test" && !error.message?.includes("192.168.1.5"),
  );
  await assert.rejects(
    () => testSemanticProviderConnection({ semantic: configured, future: true }),
    (error: { code?: string }) => error.code === "invalid-semantic-provider-test",
  );
});
