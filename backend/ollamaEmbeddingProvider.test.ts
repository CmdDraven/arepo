import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  OLLAMA_CAPABILITY_PROBE_TEXT,
  OLLAMA_MAX_RESPONSE_BYTES,
  OLLAMA_MAX_VECTOR_DIMENSIONS,
  OllamaEmbeddingProvider,
} from "./ollamaEmbeddingProvider.js";
import { EmbeddingProviderError } from "./embeddingProvider.js";

const endpoint = "http://127.0.0.1:11434";

function providerWith(fetchImpl: typeof fetch, timeoutMs = 1_000): OllamaEmbeddingProvider {
  return new OllamaEmbeddingProvider(endpoint, { fetchImpl, timeoutMs });
}

test("Ollama uses only tags and embed APIs, records provenance, and normalizes vectors", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith("/api/tags")) {
      return Response.json({
        models: [
          { name: "z-model", digest: "b".repeat(64), ignored: "/private/model" },
          { model: "a-model", digest: "a".repeat(64) },
        ],
        future: true,
      });
    }
    return Response.json({ embeddings: [[3, 4]], future: { vectors: "ignored" } });
  };
  const provider = providerWith(fetchImpl);
  const models = await provider.listModels();
  assert.deepEqual(models, [
    { name: "a-model", digest: "a".repeat(64) },
    { name: "z-model", digest: "b".repeat(64) },
  ]);
  const result = await provider.embed("a-model", ["bounded text"]);
  assert.deepEqual(result.vectors, [[0.6, 0.8]]);
  assert.deepEqual(result.identity, {
    provider: "ollama",
    endpoint,
    model: "a-model",
    modelDigest: "a".repeat(64),
    dimensions: 2,
  });
  assert.deepEqual(
    requests.map(({ url }) => url),
    [`${endpoint}/api/tags`, `${endpoint}/api/embed`],
  );
  assert.equal(requests[0]?.init?.method, "GET");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    model: "a-model",
    input: ["bounded text"],
    truncate: false,
  });
  assert.equal(
    requests.every(({ init }) => init?.redirect === "error"),
    true,
  );
});

test("localhost is pinned before provider request construction and never reaches fetch as a hostname", async () => {
  const requested: string[] = [];
  const provider = new OllamaEmbeddingProvider("http://localhost:11434", {
    fetchImpl: async (input) => {
      requested.push(String(input));
      return Response.json({ models: [] });
    },
  });
  await provider.listModels();
  assert.equal(provider.endpoint, "http://127.0.0.1:11434");
  assert.deepEqual(requested, ["http://127.0.0.1:11434/api/tags"]);
  assert.equal(
    requested.some((url) => url.includes("localhost")),
    false,
  );
});

test("capability identity uses the fixed AREPO probe and installed digest", async () => {
  const inputs: string[][] = [];
  const provider = providerWith(async (input, init) => {
    if (String(input).endsWith("/api/tags")) {
      return Response.json({ models: [{ name: "embed", digest: "c".repeat(64) }] });
    }
    inputs.push(JSON.parse(String(init?.body)).input as string[]);
    return Response.json({ embeddings: [[1, 0, 0]] });
  });
  const identity = await provider.getIdentity("embed");
  assert.deepEqual(inputs, [[OLLAMA_CAPABILITY_PROBE_TEXT]]);
  assert.equal(identity.modelDigest, "c".repeat(64));
  assert.equal(identity.dimensions, 3);
});

test("provider rejects redirects, timeouts, and raw fetch failures with bounded diagnostics", async () => {
  const redirect = providerWith(async () => Response.redirect("http://127.0.0.1:65535/private"));
  await assert.rejects(
    () => redirect.listModels(),
    (error: unknown) =>
      error instanceof EmbeddingProviderError &&
      error.kind === "invalid-provider-response" &&
      !error.message.includes("65535") &&
      !error.message.includes("private"),
  );

  const timeout = providerWith(
    async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("/private/timeout")));
      }),
    10,
  );
  await assert.rejects(
    () => timeout.listModels(),
    (error: unknown) =>
      error instanceof EmbeddingProviderError &&
      error.kind === "temporarily-unavailable" &&
      !error.message.includes("private"),
  );

  const unreachable = providerWith(async () => {
    throw new Error("ECONNREFUSED /private/example/secret.sock");
  });
  await assert.rejects(
    () => unreachable.listModels(),
    (error: unknown) =>
      error instanceof EmbeddingProviderError &&
      error.kind === "provider-unreachable" &&
      !error.message.includes("ECONNREFUSED") &&
      !error.message.includes("/private"),
  );
});

test("request batch, per-text, and aggregate text limits are enforced before fetch", async () => {
  let calls = 0;
  const provider = providerWith(async () => {
    calls += 1;
    return Response.json({ embeddings: [[1]] });
  });
  for (const texts of [
    Array(17).fill("a") as string[],
    ["a".repeat(24 * 1024 + 1)],
    Array(6).fill("a".repeat(24 * 1024)) as string[],
  ]) {
    await assert.rejects(
      () => provider.embed("embed", texts),
      (error: unknown) =>
        error instanceof EmbeddingProviderError && error.kind === "invalid-provider-response",
    );
  }
  assert.equal(calls, 0);
});

test("provider rejects oversized, malformed, and structurally invalid responses", async () => {
  const oversizedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(OLLAMA_MAX_RESPONSE_BYTES));
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  const cases: Array<{ response: Response; operation?: "models" | "embed" }> = [
    { response: new Response("{", { status: 200 }) },
    {
      response: new Response("{}", {
        headers: { "content-length": String(OLLAMA_MAX_RESPONSE_BYTES + 1) },
      }),
    },
    { response: new Response(oversizedStream) },
    { response: Response.json({ models: Array(257).fill({ name: "embed" }) }) },
    { response: Response.json({ embeddings: [] }), operation: "embed" },
    { response: Response.json({ embeddings: [[]] }), operation: "embed" },
    { response: Response.json({ embeddings: [[0, 0]] }), operation: "embed" },
    { response: Response.json({ embeddings: [[1, null]] }), operation: "embed" },
    { response: Response.json({ embeddings: [[1], [1, 2]] }), operation: "embed" },
    {
      response: Response.json({ embeddings: [Array(OLLAMA_MAX_VECTOR_DIMENSIONS + 1).fill(1)] }),
      operation: "embed",
    },
  ];
  for (const item of cases) {
    const provider = providerWith(async () => item.response);
    await assert.rejects(
      () =>
        item.operation === "embed"
          ? provider.embed("embed", item.response === cases[8]?.response ? ["a", "b"] : ["a"])
          : provider.listModels(),
      (error: unknown) =>
        error instanceof EmbeddingProviderError && error.kind === "invalid-provider-response",
    );
  }
});

test("provider foundation contains no install, pull, shell, SDK, or ML dependency path", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "backend", "ollamaEmbeddingProvider.ts"),
    "utf8",
  );
  const packageFile = JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), "package.json"), "utf8"),
  ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  for (const forbidden of [
    "node:child_process",
    "ollama pull",
    "/api/pull",
    "/api/generate",
    "/api/chat",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(
    Object.keys({ ...packageFile.dependencies, ...packageFile.devDependencies }).some((name) =>
      /ollama|tensorflow|onnx|transformers|embedding/i.test(name),
    ),
    false,
  );
});

test("provider maps model and temporary HTTP failures without response bodies", async () => {
  for (const [status, kind] of [
    [404, "model-not-found"],
    [400, "model-not-embedding-capable"],
    [503, "temporarily-unavailable"],
  ] as const) {
    const provider = providerWith(
      async () => new Response("EACCES /private/example/secret", { status }),
    );
    await assert.rejects(
      () => provider.embed("embed", ["probe"]),
      (error: unknown) =>
        error instanceof EmbeddingProviderError &&
        error.kind === kind &&
        !error.message.includes("private") &&
        !error.message.includes("EACCES"),
    );
  }
});
