export const SEMANTIC_PROVIDER_KIND = "ollama" as const;
export const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
export const SEMANTIC_PRODUCER = "arepo.semantic-similarity" as const;
export const SEMANTIC_PRODUCER_VERSION = 1;
export const SEMANTIC_TEXT_VERSION = 1;
export const SEMANTIC_SCOPE_MAX_SELECTED_PATHS = 10_000;
export const SEMANTIC_SCOPE_MAX_PATH_BYTES = 1_024;

export type SemanticScope = {
  mode: "all" | "selected";
  selectedPaths: string[];
};

export type SemanticPreference = {
  enabled: boolean;
  provider: typeof SEMANTIC_PROVIDER_KIND;
  endpoint: string;
  model: string;
  scope: SemanticScope;
};

export type SemanticProviderModel = {
  name: string;
  digest?: string;
};

export type EmbeddingProviderIdentity = {
  provider: typeof SEMANTIC_PROVIDER_KIND;
  endpoint: string;
  model: string;
  modelDigest?: string;
  dimensions: number;
};

export type SemanticVectorDerivationIdentity = {
  sourceContentHash: string;
  producer: typeof SEMANTIC_PRODUCER;
  producerVersion: typeof SEMANTIC_PRODUCER_VERSION;
  semanticTextVersion: typeof SEMANTIC_TEXT_VERSION;
  scopeIdentity: string;
  provider: EmbeddingProviderIdentity;
};

export type SemanticScopeSummary =
  | {
      mode: "all";
      eligibleCount: number;
      pairwiseRelationshipCount: number;
    }
  | {
      mode: "selected";
      selectedCount: number;
      eligibleCount: number;
      unavailableCount: number;
      pairwiseRelationshipCount: number;
    };

export type SemanticRuntimeStatusResponse = {
  provider: SemanticProviderStatusResponse;
  scope: SemanticScopeSummary;
};

type SemanticProviderStatusBase = {
  enabled: boolean;
  provider: typeof SEMANTIC_PROVIDER_KIND;
  endpoint: string;
  model: string;
  models: SemanticProviderModel[];
  producer: {
    name: typeof SEMANTIC_PRODUCER;
    version: typeof SEMANTIC_PRODUCER_VERSION;
    textVersion: typeof SEMANTIC_TEXT_VERSION;
    productionCandidates: "deferred";
  };
};

export type SemanticProviderStatusResponse =
  | (SemanticProviderStatusBase & { enabled: false; status: "disabled"; models: [] })
  | (SemanticProviderStatusBase & {
      enabled: true;
      status: "not-configured";
      diagnostic: string;
    })
  | (SemanticProviderStatusBase & {
      enabled: true;
      status: "available";
      identity: EmbeddingProviderIdentity;
    })
  | (SemanticProviderStatusBase & {
      enabled: true;
      status: "model-installed";
    })
  | (SemanticProviderStatusBase & {
      enabled: true;
      status:
        | "provider-unreachable"
        | "model-not-found"
        | "model-not-embedding-capable"
        | "invalid-provider-response"
        | "temporarily-unavailable";
      diagnostic: string;
    });

export function defaultSemanticPreference(): SemanticPreference {
  return {
    enabled: false,
    provider: SEMANTIC_PROVIDER_KIND,
    endpoint: DEFAULT_OLLAMA_ENDPOINT,
    model: "",
    scope: { mode: "selected", selectedPaths: [] },
  };
}

export function semanticVectorDerivationIdentity(
  sourceContentHash: string,
  provider: EmbeddingProviderIdentity,
  scopeIdentity: string,
): SemanticVectorDerivationIdentity {
  if (!/^[a-f0-9]{64}$/.test(sourceContentHash)) {
    throw new Error(
      "A canonical source content hash is required for semantic derivation identity.",
    );
  }
  if (!/^[a-f0-9]{64}$/.test(scopeIdentity)) {
    throw new Error("A canonical semantic scope identity is required for derivation identity.");
  }
  return {
    sourceContentHash,
    producer: SEMANTIC_PRODUCER,
    producerVersion: SEMANTIC_PRODUCER_VERSION,
    semanticTextVersion: SEMANTIC_TEXT_VERSION,
    scopeIdentity,
    provider: { ...provider },
  };
}

export function normalizeOllamaEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const authority = value.slice("http://".length).replace(/\/$/, "");
  const literal = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i.exec(authority);
  if (
    parsed.protocol !== "http:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    parsed.search !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    !literal
  ) {
    return null;
  }
  const inputHost = literal[1].toLowerCase();
  const explicitPort = literal[2];
  if (explicitPort !== undefined) {
    const portNumber = Number(explicitPort);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    (inputHost === "localhost" && hostname !== "localhost") ||
    (inputHost === "127.0.0.1" && hostname !== "127.0.0.1") ||
    (inputHost === "[::1]" && hostname !== "[::1]")
  ) {
    return null;
  }
  const pinnedHost = inputHost === "localhost" ? "127.0.0.1" : inputHost;
  return `http://${pinnedHost}${explicitPort ? `:${Number(explicitPort)}` : ""}`;
}

export function isSemanticModelName(value: unknown, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    ((allowEmpty && value === "") || /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value))
  );
}

export function isSemanticModelDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isSemanticPreference(value: unknown): value is SemanticPreference {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["enabled", "provider", "endpoint", "model", "scope"])
  ) {
    return false;
  }
  const endpoint = normalizeOllamaEndpoint(value.endpoint);
  return (
    typeof value.enabled === "boolean" &&
    value.provider === SEMANTIC_PROVIDER_KIND &&
    endpoint !== null &&
    endpoint === value.endpoint &&
    isSemanticModelName(value.model, true) &&
    isSemanticScope(value.scope)
  );
}

export function isSemanticScope(value: unknown): value is SemanticScope {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["mode", "selectedPaths"]) ||
    (value.mode !== "all" && value.mode !== "selected") ||
    !Array.isArray(value.selectedPaths) ||
    value.selectedPaths.length > SEMANTIC_SCOPE_MAX_SELECTED_PATHS ||
    !value.selectedPaths.every(isCanonicalSemanticScopePath)
  ) {
    return false;
  }
  const selectedPaths = value.selectedPaths;
  return selectedPaths.every(
    (selectedPath, index) =>
      index === 0 || compareCodeUnits(selectedPaths[index - 1], selectedPath) < 0,
  );
}

export function isCanonicalSemanticScopePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > SEMANTIC_SCOPE_MAX_PATH_BYTES ||
    value.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value.includes("//") ||
    !value.toLowerCase().endsWith(".md")
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function isSemanticProviderStatusResponse(
  value: unknown,
): value is SemanticProviderStatusResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "enabled",
      "provider",
      "endpoint",
      "model",
      "models",
      "producer",
      "status",
      "diagnostic",
      "identity",
    ]) ||
    typeof value.enabled !== "boolean" ||
    value.provider !== SEMANTIC_PROVIDER_KIND ||
    normalizeOllamaEndpoint(value.endpoint) !== value.endpoint ||
    !isSemanticModelName(value.model, true) ||
    !Array.isArray(value.models) ||
    value.models.length > 256 ||
    !value.models.every(isSemanticProviderModel) ||
    !isSemanticProducerDescriptor(value.producer)
  ) {
    return false;
  }
  if (value.status === "disabled") {
    return (
      value.enabled === false &&
      value.models.length === 0 &&
      value.diagnostic === undefined &&
      value.identity === undefined
    );
  }
  if (value.enabled !== true) return false;
  if (value.status === "available") {
    return (
      value.diagnostic === undefined &&
      isEmbeddingProviderIdentity(value.identity, value.endpoint, value.model)
    );
  }
  if (value.status === "model-installed") {
    return (
      value.diagnostic === undefined &&
      value.identity === undefined &&
      value.model !== "" &&
      value.models.some((model) => model.name === value.model)
    );
  }
  if (
    value.status !== "not-configured" &&
    value.status !== "provider-unreachable" &&
    value.status !== "model-not-found" &&
    value.status !== "model-not-embedding-capable" &&
    value.status !== "invalid-provider-response" &&
    value.status !== "temporarily-unavailable"
  ) {
    return false;
  }
  return (
    value.identity === undefined &&
    typeof value.diagnostic === "string" &&
    value.diagnostic.length > 0 &&
    value.diagnostic.length <= 256 &&
    (value.status !== "not-configured" || value.model === "")
  );
}

function isSemanticProviderModel(value: unknown): value is SemanticProviderModel {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["name", "digest"]) &&
    isSemanticModelName(value.name) &&
    (value.digest === undefined || isSemanticModelDigest(value.digest))
  );
}

function isEmbeddingProviderIdentity(
  value: unknown,
  endpoint: unknown,
  model: unknown,
): value is EmbeddingProviderIdentity {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["provider", "endpoint", "model", "modelDigest", "dimensions"]) &&
    value.provider === SEMANTIC_PROVIDER_KIND &&
    value.endpoint === endpoint &&
    value.model === model &&
    (value.modelDigest === undefined || isSemanticModelDigest(value.modelDigest)) &&
    Number.isInteger(value.dimensions) &&
    (value.dimensions as number) > 0 &&
    (value.dimensions as number) <= 8192
  );
}

function isSemanticProducerDescriptor(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["name", "version", "textVersion", "productionCandidates"]) &&
    value.name === SEMANTIC_PRODUCER &&
    value.version === SEMANTIC_PRODUCER_VERSION &&
    value.textVersion === SEMANTIC_TEXT_VERSION &&
    value.productionCandidates === "deferred"
  );
}

export function isSemanticScopeSummary(value: unknown): value is SemanticScopeSummary {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.eligibleCount) ||
    !isNonNegativeInteger(value.pairwiseRelationshipCount)
  ) {
    return false;
  }
  if (value.pairwiseRelationshipCount !== pairCount(value.eligibleCount as number)) return false;
  if (value.mode === "all") {
    return hasExactKeys(value, ["mode", "eligibleCount", "pairwiseRelationshipCount"]);
  }
  return (
    value.mode === "selected" &&
    hasExactKeys(value, [
      "mode",
      "selectedCount",
      "eligibleCount",
      "unavailableCount",
      "pairwiseRelationshipCount",
    ]) &&
    isNonNegativeInteger(value.selectedCount) &&
    isNonNegativeInteger(value.unavailableCount) &&
    (value.eligibleCount as number) <= (value.selectedCount as number) &&
    value.unavailableCount === (value.selectedCount as number) - (value.eligibleCount as number)
  );
}

export function isSemanticRuntimeStatusResponse(
  value: unknown,
): value is SemanticRuntimeStatusResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["provider", "scope"]) &&
    isSemanticProviderStatusResponse(value.provider) &&
    isSemanticScopeSummary(value.scope)
  );
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

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function pairCount(value: number): number {
  return value < 2 ? 0 : (value * (value - 1)) / 2;
}
