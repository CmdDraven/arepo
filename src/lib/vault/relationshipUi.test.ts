import assert from "node:assert/strict";
import test from "node:test";

import {
  RELATIONSHIP_PROMOTION_EXPLANATION,
  canPromoteKeptRelationship,
  initialRelationshipPromotion,
  relationshipOriginLabels,
  relationshipPromotionTarget,
} from "./relationshipUi.ts";

test("Inspect relationship origins use human-readable provenance", () => {
  assert.deepEqual(relationshipOriginLabels(["body"]), ["Note text"]);
  assert.deepEqual(relationshipOriginLabels(["metadata"]), ["Note metadata"]);
  assert.deepEqual(relationshipOriginLabels(["body", "metadata"]), ["Note text", "Note metadata"]);
});

test("promotion defaults to the current note and changes only the selected owner", () => {
  const draft = initialRelationshipPromotion("current.md", "nested/related.md");
  assert.equal(draft.ownerPath, "current.md");
  assert.equal(relationshipPromotionTarget(draft), "nested/related.md");
  assert.equal(
    relationshipPromotionTarget({ ...draft, ownerPath: "nested/related.md" }),
    "current.md",
  );
});

test("promotion copy describes metadata ownership without implying reciprocal prose edits", () => {
  assert.match(RELATIONSHIP_PROMOTION_EXPLANATION, /Markdown frontmatter/);
  assert.match(RELATIONSHIP_PROMOTION_EXPLANATION, /will not appear in the rendered note text/);
  assert.equal(
    /both files|reciprocal|visible wikilink/i.test(RELATIONSHIP_PROMOTION_EXPLANATION),
    false,
  );
});

test("read-only or already-explicit kept relationships have no active promotion control", () => {
  assert.equal(canPromoteKeptRelationship(false, false), false);
  assert.equal(canPromoteKeptRelationship(true, true), false);
  assert.equal(canPromoteKeptRelationship(true, false), true);
});
