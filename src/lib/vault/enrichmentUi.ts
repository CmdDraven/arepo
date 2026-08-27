import type { VaultFileKind } from "./contracts.ts";
import type { RelatedNotesEndpointResponse } from "./enrichmentContracts.ts";

export const RELATED_NOTES_DISABLED_EXPLANATION =
  "Related note suggestions are off for this vault. Leave them off to use only relationships you explicitly author in Markdown.";

export const ENRICHMENT_ADVANCED_DEFAULT_OPEN = false;

export type RelatedNotesInspectMode = "disabled" | "loading" | "error" | "ready" | "empty";

export function relatedNotesInspectMode(
  data: RelatedNotesEndpointResponse | null,
  loading: boolean,
  error: string | null,
): RelatedNotesInspectMode {
  if (data?.status === "disabled") return "disabled";
  if (loading) return "loading";
  if (error) return "error";
  if (data?.status === "ready" && data.candidates.length > 0) return "ready";
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
