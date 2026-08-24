import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTENT_LOAD_FAILURE,
  contentForLocalSearch,
  isCurrentVaultData,
  loadedFileContents,
  prepareVaultLoad,
  settleFileContent,
  settleVaultContents,
  type FileContentStateMap,
} from "./contentLoading.ts";
import { globalErrorForLoadFailure } from "./loadFailure.ts";
import type {
  VaultFile,
  VaultFileListResponse,
  VaultFileResponse,
  VaultIndexResponse,
} from "./contracts.ts";

const files: VaultFile[] = [
  file("a.md", "markdown"),
  file("b.txt", "plain-text"),
  file("c.txt", "plain-text"),
];

test("failed Markdown reads preserve metadata, index state, and neighboring bodies", async () => {
  const listed = fileList([file("a.md", "markdown"), file("b.md", "markdown")]);
  const indexed = indexResponse({ "a.md": "# A\n", "b.md": "# B\n" });
  const initial = prepareVaultLoad("vault", listed, indexed);

  assert.deepEqual(Object.keys(initial.fileMeta), ["a.md", "b.md"]);
  assert.deepEqual(Object.keys(initial.index.notes), ["a.md", "b.md"]);
  assert.equal(initial.fileContents["a.md"]?.status, "loading");

  const sensitiveError = new Error("EACCES: permission denied, open '/private/example/secret.md'");
  const settled = await settleVaultContents(initial, listed.files, async (entry) => {
    if (entry.path === "b.md") throw sensitiveError;
    return response(entry, "# A\n");
  });

  assert.deepEqual(settled.fileContents["a.md"], { status: "loaded", content: "# A\n" });
  assert.deepEqual(settled.fileContents["b.md"], {
    status: "failed",
    error: CONTENT_LOAD_FAILURE,
  });
  assert.deepEqual(loadedFileContents(settled.fileContents), { "a.md": "# A\n" });
  assert.deepEqual(Object.keys(settled.fileMeta), ["a.md", "b.md"]);
  assert.equal(JSON.stringify(settled).includes("/private/example/secret.md"), false);
  assert.equal(globalErrorForLoadFailure("source-content", sensitiveError), null);
});

test("failed plain-text reads do not reject the vault load", async () => {
  const listed = fileList([file("a.md", "markdown"), file("b.txt", "plain-text")]);
  const initial = prepareVaultLoad("vault", listed, indexResponse({ "a.md": "# A\n" }));
  const sensitiveError = new Error("EACCES: permission denied, open '/private/example/secret.txt'");
  const settled = await settleVaultContents(initial, listed.files, async (entry) => {
    if (entry.path === "b.txt") throw sensitiveError;
    return response(entry, "# A\n");
  });

  assert.equal(settled.fileContents["a.md"]?.status, "loaded");
  assert.deepEqual(settled.fileContents["b.txt"], {
    status: "failed",
    error: CONTENT_LOAD_FAILURE,
  });
  assert.equal(JSON.stringify(settled).includes("/private/example/secret.txt"), false);
  assert.equal(globalErrorForLoadFailure("source-content", sensitiveError), null);
});

test("mixed loads retain every successful Markdown and plain-text body", async () => {
  const listed = fileList(files);
  const initial = prepareVaultLoad("vault", listed, indexResponse({ "a.md": "# A\n" }));
  const settled = await settleVaultContents(initial, listed.files, async (entry) => {
    if (entry.path === "b.txt") throw new Error("failed");
    return response(entry, entry.path === "a.md" ? "# A\n" : "");
  });

  assert.deepEqual(loadedFileContents(settled.fileContents), {
    "a.md": "# A\n",
    "c.txt": "",
  });
  assert.deepEqual(settled.fileContents["c.txt"], { status: "loaded", content: "" });
  assert.notDeepEqual(settled.fileContents["b.txt"], settled.fileContents["c.txt"]);
});

test("vault switching does not treat prior-vault content as current", async () => {
  const vaultAList = fileList([file("only-a.md", "markdown")]);
  const vaultA = await settleVaultContents(
    prepareVaultLoad("vault-a", vaultAList, indexResponse({ "only-a.md": "# A\n" })),
    vaultAList.files,
    async (entry) => response(entry, "# A\n"),
  );
  assert.equal(isCurrentVaultData(vaultA.vaultId, "vault-a"), true);
  assert.equal(isCurrentVaultData(vaultA.vaultId, "vault-b"), false);

  const vaultBList = fileList([file("only-b.md", "markdown"), file("failed-b.txt", "plain-text")]);
  const vaultB = await settleVaultContents(
    prepareVaultLoad("vault-b", vaultBList, indexResponse({ "only-b.md": "# B\n" })),
    vaultBList.files,
    async (entry) => {
      if (entry.path === "failed-b.txt") throw new Error("failed");
      return response(entry, "# B\n");
    },
  );

  assert.deepEqual(Object.keys(vaultB.fileMeta), ["only-b.md", "failed-b.txt"]);
  assert.deepEqual(loadedFileContents(vaultB.fileContents), { "only-b.md": "# B\n" });
  assert.equal(Object.hasOwn(vaultB.fileContents, "only-a.md"), false);
  assert.equal(vaultB.fileContents["failed-b.txt"]?.status, "failed");
});

test("a failed single-file reload is sanitized and leaves unrelated state intact", async () => {
  const before: FileContentStateMap = {
    "a.md": { status: "loaded", content: "# A\n" },
    "b.txt": { status: "loaded", content: "before\n" },
  };
  const sensitiveError = new Error("EACCES: permission denied, open '/private/example/secret.txt'");
  const result = await settleFileContent(file("b.txt", "plain-text"), async () => {
    throw sensitiveError;
  });
  const after: FileContentStateMap = { ...before, "b.txt": result.state };

  assert.deepEqual(after["a.md"], before["a.md"]);
  assert.deepEqual(after["b.txt"], { status: "failed", error: CONTENT_LOAD_FAILURE });
  assert.equal(JSON.stringify(after).includes("secret-token"), false);
  assert.equal(JSON.stringify(after).includes("/private/example/secret.txt"), false);
  assert.equal(globalErrorForLoadFailure("source-content", sensitiveError), null);
  assert.equal(contentForLocalSearch(after["b.txt"]), null);
});

function file(path: string, kind: VaultFile["kind"]): VaultFile {
  return { path, kind, size: path.length, mtimeMs: 100 };
}

function fileList(entries: VaultFile[]): VaultFileListResponse {
  return { files: entries, folders: [] };
}

function indexResponse(markdown: Record<string, string>): VaultIndexResponse {
  const notes = Object.fromEntries(
    Object.keys(markdown).map((path) => [
      path,
      {
        path,
        slug: path.replace(/\.md$/i, ""),
        title: path,
        frontmatter: {},
        headings: [],
        anchors: [],
        wikilinks: [],
        tags: [],
      },
    ]),
  );
  return {
    index: {
      notes,
      bySlug: {},
      duplicateSlugs: {},
      byId: {},
      duplicateIds: {},
      excludedBySlug: {},
      duplicateExcludedSlugs: {},
      excludedPaths: [],
      outgoingLinks: {},
      backlinks: {},
      brokenLinks: [],
      orphanNotes: [],
    },
    issues: [],
  };
}

function response(entry: VaultFile, content: string): VaultFileResponse {
  return {
    ...entry,
    content,
    size: content.length,
    mtimeMs: 200,
    hash: `hash-${entry.path}`,
  };
}
