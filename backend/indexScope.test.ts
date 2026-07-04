import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultVaultIndexScope,
  indexScopeSummary,
  markdownDepthFromVaultRoot,
  markdownPathInScope,
} from "./indexScope.js";

test("markdown depth is calculated from the vault root", () => {
  assert.equal(markdownDepthFromVaultRoot("README.md"), 0);
  assert.equal(markdownDepthFromVaultRoot("Notes/note.md"), 1);
  assert.equal(markdownDepthFromVaultRoot("Reference/reference-note.md"), 1);
  assert.equal(markdownDepthFromVaultRoot("Notes/Nestest/note.md"), 2);
  assert.equal(markdownDepthFromVaultRoot("Notes\\Nestest\\note.md"), 2);
});

test("default vault index scope includes every Markdown depth", () => {
  const scope = defaultVaultIndexScope();
  assert.equal(markdownPathInScope("README.md", scope), true);
  assert.equal(markdownPathInScope("Notes/note.md", scope), true);
  assert.equal(markdownPathInScope("Notes/Nestest/note.md", scope), true);
  assert.equal(indexScopeSummary(scope), "All Markdown files");
});

test("index scope summary names common depth ranges", () => {
  assert.equal(indexScopeSummary({ markdown: { minDepth: 0, maxDepth: 0 } }), "Root only");
  assert.equal(
    indexScopeSummary({ markdown: { minDepth: 0, maxDepth: 1 } }),
    "Root through 1 folder deep",
  );
  assert.equal(
    indexScopeSummary({ markdown: { minDepth: 2, maxDepth: 2 } }),
    "Only files exactly 2 folders deep",
  );
  assert.equal(
    indexScopeSummary({ markdown: { minDepth: 1, maxDepth: 3 } }),
    "Custom depth range: 1 through 3",
  );
});
