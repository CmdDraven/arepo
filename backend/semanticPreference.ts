import { Buffer } from "node:buffer";
import { normalizeMarkdownFilePath } from "./path.js";
import {
  isSemanticModelName,
  isSemanticPreference,
  normalizeOllamaEndpoint,
  SEMANTIC_PROVIDER_KIND,
  SEMANTIC_SCOPE_MAX_PATH_BYTES,
  SEMANTIC_SCOPE_MAX_SELECTED_PATHS,
  type SemanticPreference,
  type SemanticScope,
} from "../src/lib/vault/semanticContracts.js";

export function canonicalizeSemanticPreference(value: unknown): SemanticPreference | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["enabled", "provider", "endpoint", "model", "scope"])
  ) {
    return null;
  }
  const endpoint = normalizeOllamaEndpoint(value.endpoint);
  const scope = canonicalizeSemanticScope(value.scope);
  if (
    typeof value.enabled !== "boolean" ||
    value.provider !== SEMANTIC_PROVIDER_KIND ||
    endpoint === null ||
    !isSemanticModelName(value.model, true) ||
    scope === null
  ) {
    return null;
  }
  const preference: SemanticPreference = {
    enabled: value.enabled,
    provider: SEMANTIC_PROVIDER_KIND,
    endpoint,
    model: value.model,
    scope,
  };
  return isSemanticPreference(preference) ? preference : null;
}

export function canonicalizeLegacyV2SemanticPreference(value: unknown): SemanticPreference | null {
  if (!isRecord(value) || !hasExactKeys(value, ["enabled", "provider", "endpoint", "model"])) {
    return null;
  }
  return canonicalizeSemanticPreference({
    ...value,
    scope: { mode: "selected", selectedPaths: [] },
  });
}

export function canonicalizeSemanticScope(value: unknown): SemanticScope | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["mode", "selectedPaths"]) ||
    (value.mode !== "all" && value.mode !== "selected") ||
    !Array.isArray(value.selectedPaths) ||
    value.selectedPaths.length > SEMANTIC_SCOPE_MAX_SELECTED_PATHS
  ) {
    return null;
  }
  const selected = new Set<string>();
  for (const rawPath of value.selectedPaths) {
    if (
      typeof rawPath !== "string" ||
      Buffer.byteLength(rawPath, "utf8") > SEMANTIC_SCOPE_MAX_PATH_BYTES
    ) {
      return null;
    }
    try {
      selected.add(normalizeMarkdownFilePath(rawPath));
    } catch {
      return null;
    }
  }
  return { mode: value.mode, selectedPaths: [...selected].sort(compareCodeUnits) };
}

export function renameSemanticScopePaths(
  scope: SemanticScope,
  fromPath: string,
  toPath: string,
  kind: "file" | "folder",
): { scope: SemanticScope; changed: boolean } {
  let changed = false;
  const rewritten = scope.selectedPaths.map((selectedPath) => {
    const next = renamedPath(selectedPath, fromPath, toPath, kind);
    if (next !== selectedPath) changed = true;
    return next;
  });
  if (!changed) return { scope, changed: false };
  return {
    scope: { ...scope, selectedPaths: [...new Set(rewritten)].sort(compareCodeUnits) },
    changed: true,
  };
}

function renamedPath(
  selectedPath: string,
  fromPath: string,
  toPath: string,
  kind: "file" | "folder",
): string {
  if (selectedPath === fromPath) return toPath;
  if (kind === "folder" && selectedPath.startsWith(`${fromPath}/`)) {
    return `${toPath}/${selectedPath.slice(fromPath.length + 1)}`;
  }
  return selectedPath;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
