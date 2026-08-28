import type { ExplicitRelationshipOrigin } from "./indexer.ts";

export const RELATIONSHIP_PROMOTION_EXPLANATION =
  "Store this relationship in Markdown frontmatter. It becomes part of the source and AREPO’s explicit map, but it will not appear in the rendered note text.";

export type RelationshipPromotionDraft = {
  currentPath: string;
  relatedPath: string;
  ownerPath: string;
};

export function initialRelationshipPromotion(
  currentPath: string,
  relatedPath: string,
): RelationshipPromotionDraft {
  return { currentPath, relatedPath, ownerPath: currentPath };
}

export function relationshipPromotionTarget(draft: RelationshipPromotionDraft): string {
  return draft.ownerPath === draft.currentPath ? draft.relatedPath : draft.currentPath;
}

export function relationshipOriginLabels(origins: readonly ExplicitRelationshipOrigin[]): string[] {
  return origins.flatMap((origin) =>
    origin === "body" ? ["Note text"] : origin === "metadata" ? ["Note metadata"] : [],
  );
}

export function canPromoteKeptRelationship(canMutate: boolean, explicitInSource: boolean): boolean {
  return canMutate && !explicitInSource;
}
