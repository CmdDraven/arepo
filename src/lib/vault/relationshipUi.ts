import type { ExplicitRelationshipOrigin } from "./indexer.ts";
import type { RelationshipPromotionData } from "./apiValidation.ts";

export const RELATIONSHIP_PROMOTION_EXPLANATION =
  "Store this relationship in Markdown frontmatter. It becomes part of the source and AREPO’s explicit map, but it will not appear in the rendered note text.";

export type RelationshipPromotionDraft = {
  currentPath: string;
  relatedPath: string;
  ownership: RelationshipPromotionOwnership;
};

export type RelationshipPromotionOwnership = "current" | "related" | "both";

export function initialRelationshipPromotion(
  currentPath: string,
  relatedPath: string,
): RelationshipPromotionDraft {
  return { currentPath, relatedPath, ownership: "current" };
}

export function relationshipPromotionOwnerPaths(draft: RelationshipPromotionDraft): string[] {
  if (draft.ownership === "both") return [draft.currentPath, draft.relatedPath];
  return [draft.ownership === "current" ? draft.currentPath : draft.relatedPath];
}

export function relationshipOriginLabels(origins: readonly ExplicitRelationshipOrigin[]): string[] {
  return origins.flatMap((origin) =>
    origin === "body" ? ["Note text"] : origin === "metadata" ? ["Note metadata"] : [],
  );
}

export function canPromoteKeptRelationship(canMutate: boolean): boolean {
  return canMutate;
}

export function relationshipPromotionResultNotice(data: RelationshipPromotionData): string {
  if (data.status === "partial") {
    const satisfied = data.results.find((result) => result.status !== "failed");
    const failed = data.results.find((result) => result.status === "failed");
    return `Partially complete. ${satisfied?.ownerPath ?? "One note"} now has the requested metadata. ${failed?.ownerPath ?? "The other note"} was not changed: ${failed?.status === "failed" ? failed.error : "write failed"} The kept relationship was preserved; retry to finish.`;
  }
  if (data.curationDiagnostic) return data.curationDiagnostic;
  if (data.results.every((result) => result.status === "already-present")) {
    return "The requested relationship metadata was already present.";
  }
  return data.ownership === "both"
    ? "Reciprocal relationship metadata is now present in both notes."
    : `Relationship metadata is now present in ${data.results[0]?.ownerPath}.`;
}
