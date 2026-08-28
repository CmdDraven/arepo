import type { SemanticPreference } from "./semanticContracts.js";

export const ENRICHMENT_PREFERENCES_KIND = "arepo.enrichmentPreferences" as const;
export const ENRICHMENT_PREFERENCES_SCHEMA_VERSION = 3;

export const RELATED_NOTES_EVIDENCE_KEYS = [
  "tags",
  "title",
  "headings",
  "neighbours",
  "lexical",
] as const;

export type RelatedNotesEvidenceKey = (typeof RELATED_NOTES_EVIDENCE_KEYS)[number];
export type RelatedNotesPreset = "conservative" | "balanced" | "exploratory" | "custom";
export type NamedRelatedNotesPreset = Exclude<RelatedNotesPreset, "custom">;

export type RelatedNotesEvidencePreference = {
  enabled: boolean;
  weight: number;
};

export type RelatedNotesConfiguration = {
  minimumScore: number;
  lexicalOnlyMinimumScore: number;
  maximumSuggestions: number;
  evidence: Record<RelatedNotesEvidenceKey, RelatedNotesEvidencePreference>;
};

export type RelatedNotesPreference = {
  enabled: boolean;
  preset: RelatedNotesPreset;
  configuration: RelatedNotesConfiguration;
};

export type ResolvedRelatedNotesSettings = {
  minimumScore: number;
  lexicalOnlyMinimumScore: number;
  maximumSuggestions: number;
  evidence: Record<RelatedNotesEvidenceKey, { enabled: boolean; effectiveWeight: number }>;
};

export type EnrichmentPreferences = {
  kind: typeof ENRICHMENT_PREFERENCES_KIND;
  version: typeof ENRICHMENT_PREFERENCES_SCHEMA_VERSION;
  vaultId: string;
  producers: {
    relatedNotes: RelatedNotesPreference;
    semantic: SemanticPreference;
  };
};

export type EnrichmentPreferencesStorageStatus = "default" | "stored" | "invalid";

export type EnrichmentPreferencesResponse = {
  status: "ready";
  storageStatus: EnrichmentPreferencesStorageStatus;
  preferences: EnrichmentPreferences;
  diagnostic?: string;
};

const DEFAULT_EVIDENCE: RelatedNotesConfiguration["evidence"] = {
  tags: { enabled: true, weight: 20 },
  title: { enabled: true, weight: 10 },
  headings: { enabled: true, weight: 10 },
  neighbours: { enabled: true, weight: 20 },
  lexical: { enabled: true, weight: 40 },
};

export const RELATED_NOTES_PRESETS: Record<NamedRelatedNotesPreset, RelatedNotesConfiguration> = {
  conservative: {
    minimumScore: 0.16,
    lexicalOnlyMinimumScore: 0.24,
    maximumSuggestions: 5,
    evidence: DEFAULT_EVIDENCE,
  },
  balanced: {
    minimumScore: 0.1,
    lexicalOnlyMinimumScore: 0.16,
    maximumSuggestions: 10,
    evidence: DEFAULT_EVIDENCE,
  },
  exploratory: {
    minimumScore: 0.06,
    lexicalOnlyMinimumScore: 0.1,
    maximumSuggestions: 10,
    evidence: DEFAULT_EVIDENCE,
  },
};

export const BALANCED_RELATED_NOTES_SETTINGS = resolveRelatedNotesSettings(
  namedRelatedNotesPreference("balanced", true),
);

export function namedRelatedNotesPreference(
  preset: NamedRelatedNotesPreset,
  enabled: boolean,
): RelatedNotesPreference {
  return { enabled, preset, configuration: cloneConfiguration(RELATED_NOTES_PRESETS[preset]) };
}

export function defaultEnrichmentPreferences(vaultId: string): EnrichmentPreferences {
  return {
    kind: ENRICHMENT_PREFERENCES_KIND,
    version: ENRICHMENT_PREFERENCES_SCHEMA_VERSION,
    vaultId,
    producers: {
      relatedNotes: namedRelatedNotesPreference("balanced", false),
      semantic: defaultStoredSemanticPreference(),
    },
  };
}

export function customRelatedNotesPreference(
  enabled: boolean,
  configuration: RelatedNotesConfiguration,
): RelatedNotesPreference {
  return { enabled, preset: "custom", configuration: cloneConfiguration(configuration) };
}

export function isEnrichmentPreferences(
  value: unknown,
  expectedVaultId?: string,
): value is EnrichmentPreferences {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "version", "vaultId", "producers"])) {
    return false;
  }
  if (
    value.kind !== ENRICHMENT_PREFERENCES_KIND ||
    value.version !== ENRICHMENT_PREFERENCES_SCHEMA_VERSION ||
    typeof value.vaultId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(value.vaultId) ||
    (expectedVaultId !== undefined && value.vaultId !== expectedVaultId) ||
    !isRecord(value.producers) ||
    !hasExactKeys(value.producers, ["relatedNotes", "semantic"])
  ) {
    return false;
  }
  return (
    isRelatedNotesPreference(value.producers.relatedNotes) &&
    isStoredSemanticPreference(value.producers.semantic)
  );
}

export function isRelatedNotesPreference(value: unknown): value is RelatedNotesPreference {
  if (!isRecord(value) || !hasExactKeys(value, ["enabled", "preset", "configuration"])) {
    return false;
  }
  const preset = value.preset;
  if (
    typeof value.enabled !== "boolean" ||
    (preset !== "conservative" &&
      preset !== "balanced" &&
      preset !== "exploratory" &&
      preset !== "custom") ||
    !isRelatedNotesConfiguration(value.configuration)
  ) {
    return false;
  }
  if (preset !== "custom") {
    return (
      canonicalRelatedNotesConfiguration(value.configuration) ===
      canonicalRelatedNotesConfiguration(RELATED_NOTES_PRESETS[preset])
    );
  }
  return true;
}

export function isRelatedNotesConfiguration(value: unknown): value is RelatedNotesConfiguration {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "minimumScore",
      "lexicalOnlyMinimumScore",
      "maximumSuggestions",
      "evidence",
    ]) ||
    !isUnitScore(value.minimumScore) ||
    !isUnitScore(value.lexicalOnlyMinimumScore) ||
    !Number.isInteger(value.maximumSuggestions) ||
    (value.maximumSuggestions as number) < 1 ||
    (value.maximumSuggestions as number) > 10 ||
    !isRecord(value.evidence) ||
    !hasExactKeys(value.evidence, RELATED_NOTES_EVIDENCE_KEYS)
  ) {
    return false;
  }
  let enabled = 0;
  let effectiveWeight = 0;
  for (const key of RELATED_NOTES_EVIDENCE_KEYS) {
    const evidence = value.evidence[key];
    if (
      !isRecord(evidence) ||
      !hasExactKeys(evidence, ["enabled", "weight"]) ||
      typeof evidence.enabled !== "boolean" ||
      typeof evidence.weight !== "number" ||
      !Number.isFinite(evidence.weight) ||
      evidence.weight < 0 ||
      evidence.weight > 100
    ) {
      return false;
    }
    if (evidence.enabled) {
      enabled += 1;
      effectiveWeight += evidence.weight;
    }
  }
  return enabled > 0 && effectiveWeight > 0;
}

export function resolveRelatedNotesSettings(
  preference: RelatedNotesPreference,
): ResolvedRelatedNotesSettings {
  if (!isRelatedNotesPreference(preference)) {
    throw new Error("Invalid Related Notes preferences.");
  }
  const total = RELATED_NOTES_EVIDENCE_KEYS.reduce((sum, key) => {
    const item = preference.configuration.evidence[key];
    return sum + (item.enabled && item.weight > 0 ? item.weight : 0);
  }, 0);
  const evidence = Object.fromEntries(
    RELATED_NOTES_EVIDENCE_KEYS.map((key) => {
      const item = preference.configuration.evidence[key];
      const enabled = item.enabled && item.weight > 0;
      return [
        key,
        {
          enabled,
          effectiveWeight: enabled ? roundCanonical(item.weight / total) : 0,
        },
      ];
    }),
  ) as ResolvedRelatedNotesSettings["evidence"];
  return {
    minimumScore: preference.configuration.minimumScore,
    lexicalOnlyMinimumScore: preference.configuration.lexicalOnlyMinimumScore,
    maximumSuggestions: preference.configuration.maximumSuggestions,
    evidence,
  };
}

export function canonicalResolvedRelatedNotesSettings(
  settings: ResolvedRelatedNotesSettings,
): string {
  return JSON.stringify({
    minimumScore: settings.minimumScore,
    lexicalOnlyMinimumScore: settings.lexicalOnlyMinimumScore,
    maximumSuggestions: settings.maximumSuggestions,
    evidence: Object.fromEntries(
      RELATED_NOTES_EVIDENCE_KEYS.map((key) => [key, settings.evidence[key]]),
    ),
  });
}

export function canonicalRelatedNotesConfiguration(
  configuration: RelatedNotesConfiguration,
): string {
  return JSON.stringify({
    minimumScore: configuration.minimumScore,
    lexicalOnlyMinimumScore: configuration.lexicalOnlyMinimumScore,
    maximumSuggestions: configuration.maximumSuggestions,
    evidence: Object.fromEntries(
      RELATED_NOTES_EVIDENCE_KEYS.map((key) => [key, configuration.evidence[key]]),
    ),
  });
}

export function isEnrichmentPreferencesResponse(
  value: unknown,
): value is EnrichmentPreferencesResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["status", "storageStatus", "preferences", "diagnostic"]) &&
    value.status === "ready" &&
    (value.storageStatus === "default" ||
      value.storageStatus === "stored" ||
      value.storageStatus === "invalid") &&
    isEnrichmentPreferences(value.preferences) &&
    (value.diagnostic === undefined ||
      (typeof value.diagnostic === "string" && value.diagnostic.length <= 256))
  );
}

function cloneConfiguration(value: RelatedNotesConfiguration): RelatedNotesConfiguration {
  return {
    minimumScore: value.minimumScore,
    lexicalOnlyMinimumScore: value.lexicalOnlyMinimumScore,
    maximumSuggestions: value.maximumSuggestions,
    evidence: Object.fromEntries(
      RELATED_NOTES_EVIDENCE_KEYS.map((key) => [key, { ...value.evidence[key] }]),
    ) as RelatedNotesConfiguration["evidence"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultStoredSemanticPreference(): SemanticPreference {
  return {
    enabled: false,
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "",
    scope: { mode: "selected", selectedPaths: [] },
  };
}

function isStoredSemanticPreference(value: unknown): value is SemanticPreference {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["enabled", "provider", "endpoint", "model", "scope"])
  ) {
    return false;
  }
  return (
    typeof value.enabled === "boolean" &&
    value.provider === "ollama" &&
    isNormalizedStoredLoopbackEndpoint(value.endpoint) &&
    typeof value.model === "string" &&
    (value.model === "" || /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value.model)) &&
    isStoredSemanticScope(value.scope)
  );
}

function isNormalizedStoredLoopbackEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  const authority = value.slice("http://".length);
  const literal = /^(127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/.exec(authority);
  if (!literal) return false;
  const explicitPort = literal[2];
  if (explicitPort !== undefined && (Number(explicitPort) < 1 || Number(explicitPort) > 65_535)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "http:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.hash === "" &&
      parsed.search === "" &&
      parsed.pathname === "/" &&
      (hostname === "127.0.0.1" || hostname === "[::1]") &&
      value === `http://${literal[1]}${explicitPort ? `:${Number(explicitPort)}` : ""}`
    );
  } catch {
    return false;
  }
}

function isStoredSemanticScope(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["mode", "selectedPaths"]) ||
    (value.mode !== "all" && value.mode !== "selected") ||
    !Array.isArray(value.selectedPaths) ||
    value.selectedPaths.length > 10_000
  ) {
    return false;
  }
  const selectedPaths = value.selectedPaths;
  return selectedPaths.every(
    (selectedPath, index) =>
      isStoredSemanticPath(selectedPath) &&
      (index === 0 || String(selectedPaths[index - 1]) < selectedPath),
  );
}

function isStoredSemanticPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > 1_024 ||
    value.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value.includes("//") ||
    !value.toLowerCase().endsWith(".md")
  ) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isUnitScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && hasOnlyKeys(record, keys);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function roundCanonical(value: number): number {
  return Number(value.toFixed(12));
}
