import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultSemanticPreference,
  isSemanticPreference,
  isSemanticProviderStatusResponse,
  normalizeOllamaEndpoint,
  semanticVectorDerivationIdentity,
} from "./semanticContracts.ts";

test("Ollama endpoints normalize only HTTP loopback origins", () => {
  assert.equal(normalizeOllamaEndpoint("http://127.0.0.1:11434/"), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaEndpoint("http://localhost:11434"), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaEndpoint("http://[::1]:11434"), "http://[::1]:11434");
  assert.equal(normalizeOllamaEndpoint("http://localhost:80"), "http://127.0.0.1:80");
  for (const rejected of [
    "https://127.0.0.1:11434",
    "http://192.168.1.5:11434",
    "http://8.8.8.8:11434",
    "http://example.com:11434",
    "http://user:password@127.0.0.1:11434",
    "http://127.0.0.1:11434/api/tags",
    "http://127.0.0.1:11434/?target=http://example.com",
    "http://127.0.0.1:11434/#fragment",
    "http://localhost.:11434",
    "http://localhost.localdomain:11434",
    "http://127.0.0.2:11434",
    "http://127.1:11434",
    "http://2130706433:11434",
    "http://0x7f000001:11434",
    "http://0177.0.0.1:11434",
    "http://[::ffff:127.0.0.1]:11434",
    "http://localhost:0",
    "http://localhost:65536",
  ]) {
    assert.equal(normalizeOllamaEndpoint(rejected), null, rejected);
  }
});

test("semantic vector identity covers source, text, producer, model, digest, and dimensions", () => {
  const identity = semanticVectorDerivationIdentity(
    "a".repeat(64),
    {
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "embed",
      modelDigest: "b".repeat(64),
      dimensions: 768,
    },
    "c".repeat(64),
  );
  assert.deepEqual(identity, {
    sourceContentHash: "a".repeat(64),
    producer: "arepo.semantic-similarity",
    producerVersion: 1,
    semanticTextVersion: 1,
    scopeIdentity: "c".repeat(64),
    provider: {
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "embed",
      modelDigest: "b".repeat(64),
      dimensions: 768,
    },
  });
  assert.throws(() =>
    semanticVectorDerivationIdentity("not-a-hash", identity.provider, "c".repeat(64)),
  );
  assert.throws(() =>
    semanticVectorDerivationIdentity("a".repeat(64), identity.provider, "not-a-hash"),
  );
});

test("semantic preferences are exact, normalized, independently default-off settings", () => {
  const preference = defaultSemanticPreference();
  assert.equal(isSemanticPreference(preference), true);
  assert.equal(preference.enabled, false);
  assert.equal(
    isSemanticPreference({ ...preference, enabled: true, model: "embed/model:latest" }),
    true,
  );
  assert.equal(isSemanticPreference({ ...preference, provider: "future" }), false);
  assert.equal(isSemanticPreference({ ...preference, endpoint: "http://localhost:11434/" }), false);
  assert.equal(isSemanticPreference({ ...preference, future: true }), false);
});

test("semantic status validation rejects impossible states, vectors, and unbounded diagnostics", () => {
  const base = {
    enabled: true,
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "embed-model",
    models: [{ name: "embed-model", digest: "a".repeat(64) }],
    producer: {
      name: "arepo.semantic-similarity",
      version: 1,
      textVersion: 1,
      productionCandidates: "deferred",
    },
  };
  assert.equal(
    isSemanticProviderStatusResponse({
      ...base,
      status: "model-installed",
    }),
    true,
  );
  assert.equal(
    isSemanticProviderStatusResponse({
      ...base,
      status: "available",
      identity: {
        provider: "ollama",
        endpoint: base.endpoint,
        model: base.model,
        modelDigest: "a".repeat(64),
        dimensions: 768,
      },
    }),
    true,
  );
  assert.equal(
    isSemanticProviderStatusResponse({ ...base, status: "available", vectors: [[1, 2]] }),
    false,
  );
  assert.equal(
    isSemanticProviderStatusResponse({ ...base, status: "available", identity: { dimensions: 0 } }),
    false,
  );
  assert.equal(
    isSemanticProviderStatusResponse({
      ...base,
      status: "provider-unreachable",
      diagnostic: "x".repeat(257),
    }),
    false,
  );
  assert.equal(
    isSemanticProviderStatusResponse({ ...base, enabled: false, status: "disabled" }),
    false,
  );
});
