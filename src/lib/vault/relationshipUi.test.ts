import assert from "node:assert/strict";
import test from "node:test";

import {
  RELATIONSHIP_PROMOTION_EXPLANATION,
  canPromoteKeptRelationship,
  initialRelationshipPromotion,
  relationshipOriginLabels,
  relationshipPromotionOwnerPaths,
  relationshipPromotionResultNotice,
} from "./relationshipUi.ts";

test("Inspect relationship origins use human-readable provenance", () => {
  assert.deepEqual(relationshipOriginLabels(["body"]), ["Note text"]);
  assert.deepEqual(relationshipOriginLabels(["metadata"]), ["Note metadata"]);
  assert.deepEqual(relationshipOriginLabels(["body", "metadata"]), ["Note text", "Note metadata"]);
});

test("promotion defaults to current-only and supports related-only or deterministic Both ownership", () => {
  const draft = initialRelationshipPromotion("current.md", "nested/related.md");
  assert.equal(draft.ownership, "current");
  assert.deepEqual(relationshipPromotionOwnerPaths(draft), ["current.md"]);
  assert.deepEqual(relationshipPromotionOwnerPaths({ ...draft, ownership: "related" }), [
    "nested/related.md",
  ]);
  assert.deepEqual(relationshipPromotionOwnerPaths({ ...draft, ownership: "both" }), [
    "current.md",
    "nested/related.md",
  ]);
});

test("promotion copy describes source metadata without implying visible prose edits", () => {
  assert.match(RELATIONSHIP_PROMOTION_EXPLANATION, /Markdown frontmatter/);
  assert.match(RELATIONSHIP_PROMOTION_EXPLANATION, /will not appear in the rendered note text/);
  assert.equal(/visible wikilink/i.test(RELATIONSHIP_PROMOTION_EXPLANATION), false);
});

test("body-link or metadata explicitness does not hide promotion from an authorized writer", () => {
  assert.equal(canPromoteKeptRelationship(false), false);
  assert.equal(canPromoteKeptRelationship(true), true);
});

test("partial promotion UX identifies success, failure, retained curation, and retry", () => {
  const notice = relationshipPromotionResultNotice({
    status: "partial",
    ownership: "both",
    currentPath: "a.md",
    relatedPath: "b.md",
    results: [
      {
        role: "current",
        ownerPath: "a.md",
        targetPath: "b.md",
        status: "promoted",
        file: {
          path: "a.md",
          kind: "markdown",
          size: 20,
          mtimeMs: 100,
          hash: "a".repeat(64),
        },
      },
      {
        role: "related",
        ownerPath: "b.md",
        targetPath: "a.md",
        status: "failed",
        error: "Source changed on disk.",
        code: "CONFLICT",
      },
    ],
    diagnostic: "One source was updated.",
  });
  assert.match(notice, /Partially complete/);
  assert.match(notice, /a\.md now has/);
  assert.match(notice, /b\.md was not changed/);
  assert.match(notice, /kept relationship was preserved/);
  assert.match(notice, /retry to finish/);
  assert.equal(/promotion failed/i.test(notice), false);
});
