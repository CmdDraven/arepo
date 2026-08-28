import crypto from "node:crypto";
import type { EmbeddingBatchResult, EmbeddingProvider } from "./embeddingProvider.js";
import { getMachineIndexResult } from "./indexCache.js";
import type { StructuralIndexInputManifest } from "./vaultFs.js";
import type { VaultInfo } from "./types.js";
import { prepareSemanticText } from "./semanticText.js";
import type { NoteIndex } from "../src/lib/vault/indexer.js";
import { sourceKindForPath } from "../src/lib/vault/sourcePolicy.js";
import type {
  SemanticPreference,
  SemanticScopeSummary,
} from "../src/lib/vault/semanticContracts.js";

export type ResolvedSemanticScope = {
  enabled: boolean;
  effectivePaths: string[];
  authorizedPaths: string[];
  sourceHashes: Record<string, string>;
  unavailablePaths: string[];
  summary: SemanticScopeSummary;
  scopeIdentity: string;
};

export type ScopedSemanticSource = {
  path: string;
  content: string;
  note: NoteIndex;
};

export async function resolveSemanticScope(
  vault: VaultInfo,
  preference: SemanticPreference,
  cwd = process.cwd(),
): Promise<ResolvedSemanticScope> {
  const machine = await getMachineIndexResult(vault, cwd);
  return resolveSemanticScopeFromManifest(preference, machine.manifest);
}

export function resolveSemanticScopeFromManifest(
  preference: SemanticPreference,
  manifest: StructuralIndexInputManifest,
): ResolvedSemanticScope {
  const readable = new Map(
    manifest.sources.flatMap((source) =>
      source.state === "readable" && sourceKindForPath(source.path) === "markdown"
        ? [[source.path, source.contentHash] as const]
        : [],
    ),
  );
  const effectivePaths =
    preference.scope.mode === "all"
      ? [...readable.keys()].sort(compareCodeUnits)
      : preference.scope.selectedPaths.filter((selectedPath) => readable.has(selectedPath));
  const unavailablePaths =
    preference.scope.mode === "selected"
      ? preference.scope.selectedPaths.filter((selectedPath) => !readable.has(selectedPath))
      : [];
  const authorizedPaths = preference.enabled ? effectivePaths : [];
  const sourceHashes = Object.fromEntries(
    effectivePaths.map((sourcePath) => [sourcePath, readable.get(sourcePath) as string]),
  );
  const eligibleCount = effectivePaths.length;
  const pairwiseRelationshipCount =
    eligibleCount < 2 ? 0 : (eligibleCount * (eligibleCount - 1)) / 2;
  const summary: SemanticScopeSummary =
    preference.scope.mode === "all"
      ? { mode: "all", eligibleCount, pairwiseRelationshipCount }
      : {
          mode: "selected",
          selectedCount: preference.scope.selectedPaths.length,
          eligibleCount,
          unavailableCount: unavailablePaths.length,
          pairwiseRelationshipCount,
        };
  const scopeIdentity = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        mode: preference.scope.mode,
        ...(preference.scope.mode === "selected"
          ? { selectedPaths: preference.scope.selectedPaths }
          : {}),
        effectiveSources: effectivePaths.map((sourcePath) => [
          sourcePath,
          sourceHashes[sourcePath],
        ]),
      }),
    )
    .digest("hex");
  return {
    enabled: preference.enabled,
    effectivePaths,
    authorizedPaths,
    sourceHashes,
    unavailablePaths,
    summary,
    scopeIdentity,
  };
}

export function prepareScopedSemanticBatch(
  scope: ResolvedSemanticScope,
  sources: readonly ScopedSemanticSource[],
  prepare: typeof prepareSemanticText = prepareSemanticText,
): Array<{ path: string; text: string }> {
  const authorized = new Set(scope.authorizedPaths);
  for (const source of sources) {
    if (!authorized.has(source.path)) {
      throw new Error("Semantic source is outside the effective authorized target scope.");
    }
  }
  return sources.map((source) => ({
    path: source.path,
    text: prepare({ content: source.content, note: source.note }),
  }));
}

export async function embedScopedSemanticSources(
  provider: EmbeddingProvider,
  model: string,
  scope: ResolvedSemanticScope,
  sources: readonly ScopedSemanticSource[],
  prepare: typeof prepareSemanticText = prepareSemanticText,
): Promise<EmbeddingBatchResult | null> {
  const batch = prepareScopedSemanticBatch(scope, sources, prepare);
  if (batch.length === 0) return null;
  return provider.embed(
    model,
    batch.map(({ text }) => text),
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
