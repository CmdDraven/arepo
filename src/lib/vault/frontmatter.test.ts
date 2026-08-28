import assert from "node:assert/strict";
import test from "node:test";

import {
  addRelatedMetadataEntry,
  markdownBodyForRendering,
  parseRelatedMetadata,
} from "./frontmatter.ts";

test("related metadata parser accepts only quoted YAML string sequences", () => {
  assert.deepEqual(parseRelatedMetadata("# No frontmatter\n").fieldStatus, "absent");
  const parsed = parseRelatedMetadata(
    "---\ntitle: Source\nrelated:\n  - \"[[Target]]\"\n  - '[[folder/nested-note]]'\n---\n# Body\n",
  );
  assert.equal(parsed.frontmatterStatus, "ready");
  assert.equal(parsed.fieldStatus, "supported");
  assert.deepEqual(parsed.entries, ["[[Target]]", "[[folder/nested-note]]"]);

  for (const source of [
    '---\nrelated: "[[Target]]"\n---\n',
    "---\nrelated:\n  target: Target\n---\n",
    "---\nrelated:\n  - 42\n---\n",
  ]) {
    const unsupported = parseRelatedMetadata(source);
    assert.equal(unsupported.fieldStatus, "unsupported");
    assert.equal(unsupported.entries.length, 0);
    assert.equal(unsupported.issues.length, 1);
  }
  assert.equal(parseRelatedMetadata("---\ntitle: Unclosed\n").frontmatterStatus, "malformed");
});

test("metadata insertion preserves body, comments, ordering, formatting, and newline convention", () => {
  const noFrontmatter = "# Existing\r\n\r\nBody\r\n";
  assert.deepEqual(addRelatedMetadataEntry(noFrontmatter, "folder/target"), {
    status: "updated",
    content: '---\r\nrelated:\r\n  - "[[folder/target]]"\r\n---\r\n\r\n# Existing\r\n\r\nBody\r\n',
  });

  const existing = "---\n# keep this\ntitle: 'Exact style'\ntags:\n  - alpha\n---\nBody bytes\n";
  const inserted = addRelatedMetadataEntry(existing, "target");
  assert.equal(inserted.status, "updated");
  assert.equal(
    inserted.content,
    "---\n# keep this\ntitle: 'Exact style'\ntags:\n  - alpha\nrelated:\n  - \"[[target]]\"\n---\nBody bytes\n",
  );

  const supported =
    '---\ntitle: Keep\nrelated:\n  - "[[a]]"\n  # relationship comment\nother: value\n---\nBody\n';
  const appended = addRelatedMetadataEntry(supported, "b");
  assert.equal(appended.status, "updated");
  assert.equal(
    appended.content,
    '---\ntitle: Keep\nrelated:\n  - "[[a]]"\n  # relationship comment\n  - "[[b]]"\nother: value\n---\nBody\n',
  );
  assert.deepEqual(addRelatedMetadataEntry(appended.content, "b"), {
    status: "already-present",
    content: appended.content,
  });
});

test("unsafe textual edits refuse malformed or ambiguous frontmatter without changing bytes", () => {
  for (const [source, status] of [
    ['---\nrelated: "[[a]]"\n---\nBody\n', "unsupported"],
    ["---\nrelated:\n  target: a\n---\nBody\n", "unsupported"],
    ['---\ntitle: "unterminated\n---\nBody\n', "unsupported"],
    ["---\ntitle: unclosed\nBody\n", "malformed"],
  ] as const) {
    assert.deepEqual(addRelatedMetadataEntry(source, "b"), { status, content: source });
  }
});

test("related frontmatter remains absent from the body passed to Markdown rendering", () => {
  const source = '---\ntitle: Source\nrelated:\n  - "[[Target]]"\n---\n# Visible body\n';
  assert.equal(markdownBodyForRendering(source), "# Visible body\n");
});
