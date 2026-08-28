import { Buffer } from "node:buffer";
import type { EmbeddingBatchResult, EmbeddingProvider } from "./embeddingProvider.js";
import { EmbeddingProviderError } from "./embeddingProvider.js";
import {
  isSemanticModelDigest,
  isSemanticModelName,
  normalizeOllamaEndpoint,
  SEMANTIC_PROVIDER_KIND,
  type EmbeddingProviderIdentity,
  type SemanticProviderModel,
} from "../src/lib/vault/semanticContracts.js";

export const OLLAMA_MAX_TEXTS_PER_BATCH = 16;
export const OLLAMA_MAX_TEXT_BYTES = 24 * 1024;
export const OLLAMA_MAX_AGGREGATE_TEXT_BYTES = 128 * 1024;
export const OLLAMA_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const OLLAMA_MAX_VECTOR_DIMENSIONS = 8192;
export const OLLAMA_MAX_DISCOVERED_MODELS = 256;
export const OLLAMA_CAPABILITY_PROBE_TEXT = "AREPO semantic capability test";

type FetchLike = typeof fetch;

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private modelDigests = new Map<string, string | undefined>();

  constructor(endpoint: unknown, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}) {
    const normalized = normalizeOllamaEndpoint(endpoint);
    if (!normalized) {
      throw new EmbeddingProviderError(
        "invalid-provider-response",
        "The Ollama endpoint is invalid.",
      );
    }
    this.endpoint = normalized;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async listModels(): Promise<SemanticProviderModel[]> {
    const value = await this.requestJson("/api/tags", { method: "GET" }, "models");
    if (!isRecord(value) || !Array.isArray(value.models)) throw invalidResponse();
    if (value.models.length > OLLAMA_MAX_DISCOVERED_MODELS) throw invalidResponse();
    const seen = new Map<string, string | undefined>();
    for (const raw of value.models) {
      if (!isRecord(raw)) throw invalidResponse();
      const name = isSemanticModelName(raw.name)
        ? raw.name
        : isSemanticModelName(raw.model)
          ? raw.model
          : null;
      if (!name || (raw.digest !== undefined && !isSemanticModelDigest(raw.digest))) {
        throw invalidResponse();
      }
      const digest = raw.digest as string | undefined;
      if (seen.has(name) && seen.get(name) !== digest) throw invalidResponse();
      seen.set(name, digest);
    }
    this.modelDigests = seen;
    return [...seen.entries()]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([name, digest]) => ({ name, ...(digest ? { digest } : {}) }));
  }

  async getIdentity(model: string): Promise<EmbeddingProviderIdentity> {
    requireModelName(model);
    const models = await this.listModels();
    const installed = models.find((candidate) => candidate.name === model);
    if (!installed) {
      throw new EmbeddingProviderError(
        "model-not-found",
        "The selected embedding model is not installed in Ollama.",
      );
    }
    const result = await this.embed(model, [OLLAMA_CAPABILITY_PROBE_TEXT]);
    return {
      ...result.identity,
      ...(installed.digest ? { modelDigest: installed.digest } : {}),
    };
  }

  async embed(model: string, texts: string[]): Promise<EmbeddingBatchResult> {
    requireModelName(model);
    validateTexts(texts);
    const value = await this.requestJson(
      "/api/embed",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: texts, truncate: false }),
      },
      "embed",
    );
    if (!isRecord(value) || !Array.isArray(value.embeddings)) throw invalidResponse();
    if (value.embeddings.length !== texts.length) throw invalidResponse();
    let dimensions: number | undefined;
    const vectors = value.embeddings.map((raw): number[] => {
      if (
        !Array.isArray(raw) ||
        raw.length === 0 ||
        raw.length > OLLAMA_MAX_VECTOR_DIMENSIONS ||
        raw.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
      ) {
        throw invalidResponse();
      }
      if (dimensions === undefined) dimensions = raw.length;
      if (raw.length !== dimensions) throw invalidResponse();
      const norm = Math.sqrt(raw.reduce((sum, entry) => sum + entry * entry, 0));
      if (!Number.isFinite(norm) || norm === 0) throw invalidResponse();
      return raw.map((entry) => entry / norm);
    });
    if (!dimensions) throw invalidResponse();
    const digest = this.modelDigests.get(model);
    return {
      identity: {
        provider: SEMANTIC_PROVIDER_KIND,
        endpoint: this.endpoint,
        model,
        ...(digest ? { modelDigest: digest } : {}),
        dimensions,
      },
      vectors,
    };
  }

  private async requestJson(
    pathname: "/api/tags" | "/api/embed",
    init: RequestInit,
    operation: "models" | "embed",
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.endpoint}${pathname}`, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw statusError(response.status, operation);
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > OLLAMA_MAX_RESPONSE_BYTES) {
        throw invalidResponse();
      }
      const text = await readBoundedResponse(response);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw invalidResponse();
      }
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error;
      throw controller.signal.aborted
        ? new EmbeddingProviderError("temporarily-unavailable", "The Ollama request timed out.")
        : new EmbeddingProviderError(
            "provider-unreachable",
            "The configured Ollama service could not be reached.",
          );
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateTexts(texts: string[]): void {
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > OLLAMA_MAX_TEXTS_PER_BATCH) {
    throw new EmbeddingProviderError(
      "invalid-provider-response",
      "The embedding request exceeds AREPO's configured bounds.",
    );
  }
  let aggregate = 0;
  for (const text of texts) {
    if (typeof text !== "string" || text.length === 0) throw invalidResponse();
    const bytes = Buffer.byteLength(text);
    if (bytes > OLLAMA_MAX_TEXT_BYTES) throw invalidResponse();
    aggregate += bytes;
  }
  if (aggregate > OLLAMA_MAX_AGGREGATE_TEXT_BYTES) throw invalidResponse();
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > OLLAMA_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw invalidResponse();
    }
    chunks.push(next.value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    throw invalidResponse();
  }
}

function statusError(status: number, operation: "models" | "embed"): EmbeddingProviderError {
  if (operation === "embed" && status === 404) {
    return new EmbeddingProviderError(
      "model-not-found",
      "The selected embedding model is not installed in Ollama.",
    );
  }
  if (operation === "embed" && (status === 400 || status === 422)) {
    return new EmbeddingProviderError(
      "model-not-embedding-capable",
      "The selected Ollama model could not produce an embedding.",
    );
  }
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return new EmbeddingProviderError(
      "temporarily-unavailable",
      "The configured Ollama service is temporarily unavailable.",
    );
  }
  return invalidResponse();
}

function requireModelName(model: string): void {
  if (!isSemanticModelName(model)) {
    throw new EmbeddingProviderError(
      "model-not-found",
      "A valid installed Ollama model must be selected.",
    );
  }
}

function invalidResponse(): EmbeddingProviderError {
  return new EmbeddingProviderError(
    "invalid-provider-response",
    "Ollama returned an invalid or unsupported response.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
