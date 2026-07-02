import assert from "node:assert/strict";
import test from "node:test";

import { buildIndexFilterResponse } from "./indexFilters.js";
import { buildVaultInspectResponse } from "./indexInspect.js";
import { buildIndexSearchResponse } from "./indexSearch.js";
import type { IndexFilterKind, VaultIndexResponse } from "./types.js";

function emptyIndex(): VaultIndexResponse {
  return {
    index: {
      notes: {},
      bySlug: {},
      duplicateSlugs: {},
      byId: {},
      outgoingLinks: {},
      backlinks: {},
      brokenLinks: [],
      orphanNotes: [],
    },
    issues: [],
  };
}

function mappingIndex(): VaultIndexResponse {
  return {
    index: {
      notes: {
        "Alpha.md": {
          path: "Alpha.md",
          slug: "alpha",
          title: "Alpha Note",
          frontmatter: { id: "same-id", title: "Alpha Note", tags: ["project", "shared"] },
          headings: [
            { level: 1, text: "Alpha Note", anchor: "alpha-note", explicit: false },
            { level: 2, text: "Shared Section", anchor: "duplicate-anchor", explicit: true },
            { level: 3, text: "Repeated Section", anchor: "duplicate-anchor", explicit: true },
          ],
          anchors: ["alpha-note", "duplicate-anchor", "duplicate-anchor"],
          wikilinks: [
            { target: "Beta", raw: "Beta" },
            { target: "Missing", raw: "Missing" },
          ],
          tags: ["project", "shared"],
          body: "This body-only-secret text should not be searched by index helpers.",
        },
        "Folder/Beta.md": {
          path: "Folder/Beta.md",
          slug: "beta",
          title: "Beta Note",
          frontmatter: { id: "same-id", title: "Beta Note", tags: ["project", "beta"] },
          headings: [{ level: 1, text: "Beta Note", anchor: "beta-note", explicit: false }],
          anchors: ["beta-note"],
          wikilinks: [{ target: "Alpha", raw: "Alpha" }],
          tags: ["project", "beta"],
          body: "Beta body content.",
        },
        "Folder/Gamma.md": {
          path: "Folder/Gamma.md",
          slug: "gamma",
          title: "Gamma Note",
          frontmatter: { id: "gamma-id", title: "Gamma Note", tags: ["zeta"] },
          headings: [{ level: 1, text: "Gamma Note", anchor: "gamma-note", explicit: false }],
          anchors: ["gamma-note"],
          wikilinks: [],
          tags: ["zeta"],
          body: "Gamma body content.",
        },
      },
      bySlug: {
        alpha: "Alpha.md",
        beta: "Folder/Beta.md",
        gamma: "Folder/Gamma.md",
      },
      duplicateSlugs: {},
      byId: {
        "same-id": "Alpha.md",
        "gamma-id": "Folder/Gamma.md",
      },
      outgoingLinks: {
        "Alpha.md": [
          {
            target: "Beta",
            targetPath: "Folder/Beta.md",
            raw: "Beta",
            status: "resolved",
            broken: false,
          },
          { target: "Missing", raw: "Missing", status: "broken", broken: true },
        ],
        "Folder/Beta.md": [
          {
            target: "Alpha",
            targetPath: "Alpha.md",
            raw: "Alpha",
            status: "resolved",
            broken: false,
          },
        ],
        "Folder/Gamma.md": [],
      },
      backlinks: {
        "Alpha.md": [{ fromPath: "Folder/Beta.md" }],
        "Folder/Beta.md": [{ fromPath: "Alpha.md" }],
      },
      brokenLinks: [{ fromPath: "Alpha.md", target: "Missing", raw: "Missing" }],
      orphanNotes: ["Folder/Gamma.md"],
    },
    issues: [
      {
        kind: "broken-wikilink",
        path: "Alpha.md",
        message: "Broken link [[Missing]]",
        severity: "error",
      },
      {
        kind: "duplicate-id",
        path: "Alpha.md",
        message: "Duplicate frontmatter id same-id",
        severity: "warning",
      },
      {
        kind: "duplicate-id",
        path: "Folder/Beta.md",
        message: "Duplicate frontmatter id same-id",
        severity: "warning",
      },
      {
        kind: "duplicate-anchor",
        path: "Alpha.md",
        message: "Duplicate heading anchor duplicate-anchor",
        severity: "warning",
      },
    ],
  };
}

function filter(data: VaultIndexResponse, kind: IndexFilterKind) {
  return buildIndexFilterResponse(data, kind);
}

test("index structural filters return clean empty machine-index responses", () => {
  const data = emptyIndex();
  for (const kind of [
    "broken-links",
    "orphan-notes",
    "tags",
    "folders",
    "duplicate-ids",
    "duplicate-anchors",
  ] satisfies IndexFilterKind[]) {
    const response = filter(data, kind);
    assert.equal(response.filter, kind);
    assert.equal(response.source, "machine-index");
    assert.equal(response.total, 0);
    assert.deepEqual(response.results, []);
  }
});

test("index structural filters expose duplicate, broken-link, tag, and folder metadata", () => {
  const data = mappingIndex();

  const broken = filter(data, "broken-links");
  assert.equal(broken.total, 1);
  assert.deepEqual(
    broken.results.map(({ path, target, title, reason }) => ({ path, target, title, reason })),
    [
      {
        path: "Alpha.md",
        target: "Missing",
        title: "Alpha Note",
        reason: "Broken wikilink [[Missing]]",
      },
    ],
  );

  const orphans = filter(data, "orphan-notes");
  assert.deepEqual(
    orphans.results.map((result) => result.path),
    ["Folder/Gamma.md"],
  );

  const tags = filter(data, "tags");
  assert.deepEqual(
    tags.results.map((result) => `${result.tag}:${result.path}`),
    [
      "project:Alpha.md",
      "shared:Alpha.md",
      "project:Folder/Beta.md",
      "beta:Folder/Beta.md",
      "zeta:Folder/Gamma.md",
    ],
  );

  const folders = filter(data, "folders");
  assert.deepEqual(
    folders.results.map((result) => `${result.folder}:${result.path}`),
    ["/:Alpha.md", "Folder:Folder/Beta.md", "Folder:Folder/Gamma.md"],
  );

  const duplicateIds = filter(data, "duplicate-ids");
  assert.deepEqual(
    duplicateIds.results.map((result) => `${result.duplicateKey}:${result.path}`),
    ["same-id:Alpha.md", "same-id:Folder/Beta.md"],
  );

  const duplicateAnchors = filter(data, "duplicate-anchors");
  assert.deepEqual(
    duplicateAnchors.results.map((result) => `${result.anchor}:${result.headingText}`),
    ["duplicate-anchor:Shared Section", "duplicate-anchor:Repeated Section"],
  );
});

test("index search normalizes input, keeps deterministic order, and searches structural fields only", () => {
  const data = mappingIndex();

  assert.deepEqual(buildIndexSearchResponse(data, "   "), {
    q: "",
    total: 0,
    source: "machine-index",
    results: [],
  });

  const title = buildIndexSearchResponse(data, "  alpha note  ");
  const titleUpper = buildIndexSearchResponse(data, "ALPHA NOTE");
  assert.equal(title.q, "alpha note");
  assert.equal(title.source, "machine-index");
  assert.equal(title.results[0]?.path, "Alpha.md");
  assert.equal(title.results[0]?.matchedField, "title");
  assert.deepEqual(
    title.results.map((result) => result.id),
    titleUpper.results.map((result) => result.id),
  );

  const path = buildIndexSearchResponse(data, "Alpha.md");
  assert.equal(path.results[0]?.path, "Alpha.md");
  assert.equal(path.results[0]?.matchedField, "path");

  const tag = buildIndexSearchResponse(data, "PROJECT");
  assert.deepEqual(
    tag.results.map((result) => `${result.matchType}:${result.path}:${result.matchedValue}`),
    ["tag:Alpha.md:project", "tag:Folder/Beta.md:project"],
  );

  const heading = buildIndexSearchResponse(data, "duplicate-anchor");
  assert.ok(
    heading.results.some(
      (result) =>
        result.matchType === "anchor" &&
        result.path === "Alpha.md" &&
        result.anchor === "duplicate-anchor",
    ),
  );

  const link = buildIndexSearchResponse(data, "Folder/Beta.md");
  assert.ok(
    link.results.some(
      (result) => result.matchType === "link-target" && result.targetPath === "Folder/Beta.md",
    ),
  );

  const backlink = buildIndexSearchResponse(data, "Beta Note");
  assert.ok(
    backlink.results.some(
      (result) => result.matchType === "backlink" && result.fromPath === "Folder/Beta.md",
    ),
  );

  const bodyLeak = buildIndexSearchResponse(data, "body-only-secret");
  assert.equal(bodyLeak.total, 0);

  assert.deepEqual(
    buildIndexSearchResponse(data, "note").results.map((result) => result.id),
    buildIndexSearchResponse(data, "note").results.map((result) => result.id),
  );
});

test("index inspect reports missing paths and file-level relationship details", () => {
  const data = mappingIndex();

  assert.throws(() => buildVaultInspectResponse(data, null), /path is required/);
  assert.throws(() => buildVaultInspectResponse(data, "Missing.md"), {
    message: "Unknown indexed note: Missing.md",
    code: "ENOENT",
  });

  const alpha = buildVaultInspectResponse(data, "Alpha.md");
  assert.equal(alpha.source, "machine-index");
  assert.equal(alpha.path, "Alpha.md");
  assert.equal(alpha.title, "Alpha Note");
  assert.equal(alpha.frontmatterId, "same-id");
  assert.deepEqual(alpha.tags, ["project", "shared"]);
  assert.deepEqual(alpha.anchors, ["alpha-note", "duplicate-anchor", "duplicate-anchor"]);
  assert.ok(alpha.headings.some((heading) => heading.anchor === "duplicate-anchor"));
  assert.ok(
    alpha.outgoingLinks.some(
      (link) => link.target === "Beta" && link.targetPath === "Folder/Beta.md" && !link.broken,
    ),
  );
  assert.deepEqual(
    alpha.brokenOutgoingLinks.map((link) => `${link.target}:${link.broken}`),
    ["Missing:true"],
  );
  assert.deepEqual(
    alpha.backlinks.map((backlink) => backlink.fromPath),
    ["Folder/Beta.md"],
  );
  assert.deepEqual(alpha.duplicateId, { id: "same-id", paths: ["Alpha.md", "Folder/Beta.md"] });
  assert.equal(alpha.duplicateAnchors[0]?.anchor, "duplicate-anchor");
  assert.equal(alpha.duplicateAnchors[0]?.headings.length, 2);
  assert.equal(alpha.orphan, false);
  assert.ok(alpha.issues.some((issue) => issue.kind === "broken-wikilink"));

  const orphan = buildVaultInspectResponse(data, "Folder/Gamma.md");
  assert.equal(orphan.orphan, true);
  assert.deepEqual(orphan.backlinks, []);
  assert.deepEqual(orphan.outgoingLinks, []);
});

test("mapping helpers operate on supplied rebuildable index data rather than app cache state", () => {
  const data = mappingIndex();
  data.index.notes["Scratch.md"] = {
    path: "Scratch.md",
    slug: "scratch",
    title: "Scratch Runtime Note",
    frontmatter: { id: "scratch-id", title: "Scratch Runtime Note", tags: ["runtime"] },
    headings: [
      { level: 1, text: "Scratch Runtime Note", anchor: "scratch-runtime-note", explicit: false },
    ],
    anchors: ["scratch-runtime-note"],
    wikilinks: [],
    tags: ["runtime"],
    body: "This note exists only in the supplied in-memory machine index.",
  };
  data.index.outgoingLinks["Scratch.md"] = [];
  data.index.orphanNotes.push("Scratch.md");

  assert.ok(
    filter(data, "tags").results.some(
      (result) => result.path === "Scratch.md" && result.tag === "runtime",
    ),
  );
  assert.ok(
    buildIndexSearchResponse(data, "scratch-runtime-note").results.some(
      (result) => result.path === "Scratch.md" && result.matchType === "anchor",
    ),
  );
  assert.equal(buildVaultInspectResponse(data, "Scratch.md").orphan, true);
});
