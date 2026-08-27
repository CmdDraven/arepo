import type { VaultFileKind } from "./contracts.ts";
import type { RelatedNotesEndpointResponse } from "./enrichmentContracts.ts";
import type { RelatedNotesCurationFreshness } from "./enrichmentContracts.ts";

export const RELATED_NOTES_DISABLED_EXPLANATION =
  "Related note suggestions are off for this vault. Leave them off to use only relationships you explicitly author in Markdown.";

export const ENRICHMENT_ADVANCED_DEFAULT_OPEN = false;
export const RELATED_NOTES_KEEP_EXPLANATION =
  "Keep this relationship in AREPO even if suggestions are recalculated.";
export const RELATED_NOTES_DISMISS_EXPLANATION =
  "Hide this relationship from future Related Notes suggestions.";

export type RelatedNotesInspectMode = "disabled" | "loading" | "error" | "ready" | "empty";

export function relatedNotesInspectMode(
  data: RelatedNotesEndpointResponse | null,
  loading: boolean,
  error: string | null,
): RelatedNotesInspectMode {
  if (data?.status === "disabled") return "disabled";
  if (loading) return "loading";
  if (error) return "error";
  if (data?.status === "ready" && (data.candidates.length > 0 || data.curation.kept.length > 0))
    return "ready";
  return "empty";
}

export function showEnrichmentManageAction(
  mode: RelatedNotesInspectMode,
  canManageVaults: boolean,
): boolean {
  return mode === "disabled" && canManageVaults;
}

export function sourceSupportsRelatedNotes(kind: VaultFileKind): boolean {
  return kind === "markdown";
}

export function showCurationActions(relatedNotesEnabled: boolean, canMutate: boolean): boolean {
  return relatedNotesEnabled && canMutate;
}

export function curationFreshnessLabel(freshness: RelatedNotesCurationFreshness): string {
  switch (freshness) {
    case "current":
      return "Sources match the versions seen when this decision was made.";
    case "left-changed":
      return "The first note changed after this decision.";
    case "right-changed":
      return "The second note changed after this decision.";
    case "both-changed":
      return "Both notes changed after this decision.";
    case "left-missing":
      return "The first note is currently missing.";
    case "right-missing":
      return "The second note is currently missing.";
    case "both-missing":
      return "Both notes are currently missing.";
  }
}
