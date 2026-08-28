import type { EmbeddingProvider } from "./embeddingProvider.js";
import { EmbeddingProviderError } from "./embeddingProvider.js";
import { readEnrichmentPreferences } from "./enrichmentPreferences.js";
import { canonicalizeSemanticPreference } from "./semanticPreference.js";
import { resolveSemanticScope } from "./semanticScope.js";
import {
  OLLAMA_CAPABILITY_PROBE_TEXT,
  OllamaEmbeddingProvider,
} from "./ollamaEmbeddingProvider.js";
import { PublicApiError } from "./publicApiError.js";
import type { VaultInfo } from "./types.js";
import {
  SEMANTIC_PRODUCER,
  SEMANTIC_PRODUCER_VERSION,
  SEMANTIC_TEXT_VERSION,
  type SemanticPreference,
  type SemanticProviderStatusResponse,
  type SemanticRuntimeStatusResponse,
} from "../src/lib/vault/semanticContracts.js";

const PRODUCER_DESCRIPTOR = {
  name: SEMANTIC_PRODUCER,
  version: SEMANTIC_PRODUCER_VERSION,
  textVersion: SEMANTIC_TEXT_VERSION,
  productionCandidates: "deferred" as const,
} as const;

export async function getSemanticProviderStatus(
  vault: Pick<VaultInfo, "id">,
  cwd = process.cwd(),
): Promise<SemanticProviderStatusResponse> {
  const preferences = await readEnrichmentPreferences(vault, cwd);
  return semanticProviderDiscoveryStatusForPreference(preferences.preferences.producers.semantic);
}

export async function getSemanticRuntimeStatus(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<SemanticRuntimeStatusResponse> {
  const preferences = await readEnrichmentPreferences(vault, cwd);
  const semantic = preferences.preferences.producers.semantic;
  const [provider, scope] = await Promise.all([
    semanticProviderDiscoveryStatusForPreference(semantic),
    resolveSemanticScope(vault, semantic),
  ]);
  return { provider, scope: scope.summary };
}

export async function semanticProviderDiscoveryStatusForPreference(
  preference: SemanticPreference,
  provider: EmbeddingProvider = new OllamaEmbeddingProvider(preference.endpoint),
): Promise<SemanticProviderStatusResponse> {
  const base = providerStatusBase(preference);
  if (!preference.enabled) return { ...base, enabled: false, status: "disabled", models: [] };
  let models: Awaited<ReturnType<EmbeddingProvider["listModels"]>> = [];
  try {
    models = await provider.listModels();
    if (!preference.model) {
      return {
        ...base,
        enabled: true,
        status: "not-configured",
        models,
        diagnostic: "Select an installed Ollama embedding model.",
      };
    }
    if (!models.some((model) => model.name === preference.model)) {
      return {
        ...base,
        enabled: true,
        status: "model-not-found",
        models,
        diagnostic: "The selected embedding model is not installed in Ollama.",
      };
    }
    return { ...base, enabled: true, status: "model-installed", models };
  } catch (error) {
    const failure = expectedProviderFailure(error);
    return {
      ...base,
      enabled: true,
      status: failure.kind,
      models,
      diagnostic: publicProviderDiagnostic(failure.kind),
    };
  }
}

export async function testSemanticProviderConnection(
  raw: unknown,
): Promise<SemanticProviderStatusResponse> {
  const semantic =
    isRecord(raw) && hasExactKeys(raw, ["semantic"])
      ? canonicalizeSemanticPreference(raw.semantic)
      : null;
  if (!semantic) {
    throw new PublicApiError(400, "Semantic provider test settings are invalid.", {
      code: "invalid-semantic-provider-test",
    });
  }
  return semanticProviderStatusForPreference(semantic);
}

export async function semanticProviderStatusForPreference(
  preference: SemanticPreference,
  provider: EmbeddingProvider = new OllamaEmbeddingProvider(preference.endpoint),
): Promise<SemanticProviderStatusResponse> {
  const base = providerStatusBase(preference);
  if (!preference.enabled) return { ...base, enabled: false, status: "disabled", models: [] };
  let models: Awaited<ReturnType<EmbeddingProvider["listModels"]>> = [];
  try {
    models = await provider.listModels();
    if (!preference.model) {
      return {
        ...base,
        enabled: true,
        status: "not-configured",
        models,
        diagnostic: "Select an installed Ollama embedding model.",
      };
    }
    const installed = models.find((model) => model.name === preference.model);
    if (!installed) {
      return {
        ...base,
        enabled: true,
        status: "model-not-found",
        models,
        diagnostic: "The selected embedding model is not installed in Ollama.",
      };
    }
    const probe = await provider.embed(preference.model, [OLLAMA_CAPABILITY_PROBE_TEXT]);
    return {
      ...base,
      enabled: true,
      status: "available",
      models,
      identity: {
        ...probe.identity,
        ...(installed.digest ? { modelDigest: installed.digest } : {}),
      },
    };
  } catch (error) {
    const failure = expectedProviderFailure(error);
    return {
      ...base,
      enabled: true,
      status: failure.kind,
      models,
      diagnostic: publicProviderDiagnostic(failure.kind),
    };
  }
}

function providerStatusBase(preference: SemanticPreference) {
  return {
    enabled: preference.enabled,
    provider: preference.provider,
    endpoint: preference.endpoint,
    model: preference.model,
    producer: PRODUCER_DESCRIPTOR,
  } as const;
}

function expectedProviderFailure(error: unknown): EmbeddingProviderError {
  return error instanceof EmbeddingProviderError
    ? error
    : new EmbeddingProviderError(
        "invalid-provider-response",
        "The semantic provider returned an invalid response.",
      );
}

function publicProviderDiagnostic(kind: EmbeddingProviderError["kind"]): string {
  switch (kind) {
    case "provider-unreachable":
      return "The configured Ollama service could not be reached.";
    case "model-not-found":
      return "The selected embedding model is not installed in Ollama.";
    case "model-not-embedding-capable":
      return "The selected Ollama model could not produce an embedding.";
    case "invalid-provider-response":
      return "Ollama returned an invalid or unsupported response.";
    case "temporarily-unavailable":
      return "The configured Ollama service is temporarily unavailable.";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return (
    Object.keys(record).length === keys.length &&
    Object.keys(record).every((key) => allowed.has(key))
  );
}
