import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTENT_LOAD_FAILURE,
  contentStateAfterPathStatusFailure,
  contentForLocalSearch,
  isFileContentState,
  isCurrentVaultData,
  loadedFileContents,
  prepareVaultLoad,
  settleFileContent,
  settleVaultContents,
  type FileContentStateMap,
} from "./contentLoading.ts";
import { parseChatExportV1 } from "./chatExport.ts";
import { JSON_RAW_CONTENT_MAX_BYTES, SOURCE_TOO_LARGE_CODE } from "./jsonBounds.ts";
import { globalErrorForLoadFailure } from "./loadFailure.ts";
import type {
  VaultFile,
  VaultFileListResponse,
  VaultFileResponse,
  VaultIndexResponse,
} from "./contracts.ts";
import { ApiResponseValidationError } from "./apiTransport.ts";

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

test("valid chat content survives a failed neighboring source and remains vault-scoped", async () => {
  const listed = fileList([
    file("conversation.arepo-chat.json", "chat-json"),
    file("unreadable.txt", "plain-text"),
  ]);
  const source =
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"conv"},"messages":[]}';
  const settled = await settleVaultContents(
    prepareVaultLoad("vault-chat", listed, indexResponse({})),
    listed.files,
    async (entry) => {
      if (entry.path === "unreadable.txt") throw new Error("private failure");
      return response(entry, source);
    },
  );

  assert.deepEqual(settled.fileContents["conversation.arepo-chat.json"], {
    status: "loaded",
    content: source,
  });
  assert.equal(settled.fileContents["unreadable.txt"]?.status, "failed");
  assert.equal(isCurrentVaultData(settled.vaultId, "vault-chat"), true);
  assert.equal(isCurrentVaultData(settled.vaultId, "other-vault"), false);
});

test("an unreadable chat source is isolated and sanitized like every source body", async () => {
  const listed = fileList([
    file("note.md", "markdown"),
    file("unreadable.arepo-chat.json", "chat-json"),
  ]);
  const sensitiveError = new Error("EACCES: open '/private/example/conversation.arepo-chat.json'");
  const settled = await settleVaultContents(
    prepareVaultLoad("vault-chat-failure", listed, indexResponse({ "note.md": "# Note\n" })),
    listed.files,
    async (entry) => {
      if (entry.kind === "chat-json") {
        throw sensitiveError;
      }
      return response(entry, "# Note\n");
    },
  );

  assert.deepEqual(settled.fileContents["unreadable.arepo-chat.json"], {
    status: "failed",
    error: CONTENT_LOAD_FAILURE,
  });
  assert.deepEqual(settled.fileContents["note.md"], {
    status: "loaded",
    content: "# Note\n",
  });
  assert.equal(JSON.stringify(settled).includes("/private/example"), false);
  assert.equal(globalErrorForLoadFailure("source-content", sensitiveError), null);
});

test("an empty chat body is loaded content but remains distinct from a valid empty conversation", async () => {
  const chatFile = file("empty.arepo-chat.json", "chat-json");
  const loaded = await settleFileContent(chatFile, async (entry) => response(entry, ""));
  const validEmpty = parseChatExportV1(
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"conv-empty"},"messages":[]}',
  );

  assert.deepEqual(loaded.state, { status: "loaded", content: "" });
  assert.equal(parseChatExportV1("").ok, false);
  assert.equal(validEmpty.ok, true);
  if (validEmpty.ok) assert.deepEqual(validEmpty.data.messages, []);
});

test("oversized JSON remains listed, skips body loading, and is metadata-searchable only", async () => {
  const oversized: VaultFile = {
    path: "large.json",
    kind: "generic-json",
    size: JSON_RAW_CONTENT_MAX_BYTES + 1,
    mtimeMs: 100,
  };
  let reads = 0;
  const initial = prepareVaultLoad("vault", fileList([oversized]), indexResponse({}));
  const settled = await settleVaultContents(initial, [oversized], async (entry) => {
    reads += 1;
    return response(entry, "must not be read");
  });

  assert.equal(reads, 0);
  assert.deepEqual(settled.fileContents[oversized.path], { status: "too-large" });
  assert.equal(contentForLocalSearch(settled.fileContents[oversized.path]), null);
  assert.equal(settled.fileMeta[oversized.path]?.size, JSON_RAW_CONTENT_MAX_BYTES + 1);
});

test("a backend byte-race rejection becomes too-large rather than unavailable", async () => {
  const jsonFile = file("growing.json", "generic-json");
  const error = Object.assign(new Error("Source is too large to preview safely."), {
    code: SOURCE_TOO_LARGE_CODE,
  });
  const result = await settleFileContent(jsonFile, async () => {
    throw error;
  });

  assert.deepEqual(result.state, { status: "too-large" });
  assert.equal(JSON.stringify(result).includes(error.message), false);
});

test("generic valid and malformed JSON load as exact raw UTF-8 without parsing", async () => {
  const valid = '{\n  "mixed": [null, true, {"n": 1.00}]\n}\n';
  const malformed = '{\n  "repair-me": true,\n';
  for (const [path, source] of [
    ["valid.json", valid],
    ["malformed.json", malformed],
  ] as const) {
    const result = await settleFileContent(file(path, "generic-json"), async (entry) =>
      response(entry, source),
    );
    assert.deepEqual(result.state, { status: "loaded", content: source });
  }
});

test("chat reload transitions replace stale structured semantics with current raw or V1 content", async () => {
  const chatFile = file("transition.arepo-chat.json", "chat-json");
  const unsupported = '{"format":"arepo-chat-export","version":2,"private":"raw-v2"}';
  const valid =
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"current"},"messages":[]}';
  const malformed = '{"format":"arepo-chat-export"';

  const first = await settleFileContent(chatFile, async (entry) => response(entry, unsupported));
  assert.equal(first.state.status, "loaded");
  if (first.state.status === "loaded")
    assert.equal(parseChatExportV1(first.state.content).ok, false);
  const second = await settleFileContent(chatFile, async (entry) => response(entry, valid));
  assert.equal(second.state.status, "loaded");
  if (second.state.status === "loaded")
    assert.equal(parseChatExportV1(second.state.content).ok, true);
  const third = await settleFileContent(chatFile, async (entry) => response(entry, malformed));
  assert.deepEqual(third.state, { status: "loaded", content: malformed });
  if (third.state.status === "loaded")
    assert.equal(parseChatExportV1(third.state.content).ok, false);
});

test("generic JSON reload transitions from current raw content to a too-large state", async () => {
  const initialFile = file("transition.json", "generic-json");
  const before = await settleFileContent(initialFile, async (entry) =>
    response(entry, '{"state":"before"}\n'),
  );
  assert.deepEqual(before.state, { status: "loaded", content: '{"state":"before"}\n' });

  const refreshed = await settleFileContent(initialFile, async (entry) =>
    response(entry, '{"state":"after-search-token"}\n'),
  );
  assert.equal(contentForLocalSearch(refreshed.state), '{"state":"after-search-token"}\n');

  const grown: VaultFile = { ...initialFile, size: JSON_RAW_CONTENT_MAX_BYTES + 1 };
  let reads = 0;
  const after = await settleFileContent(grown, async (entry) => {
    reads += 1;
    return response(entry, "must not load");
  });
  assert.equal(reads, 0);
  assert.deepEqual(after.state, { status: "too-large" });

  const recovered = await settleFileContent(initialFile, async (entry) =>
    response(entry, '{"state":"small-again"}\n'),
  );
  assert.deepEqual(recovered.state, {
    status: "loaded",
    content: '{"state":"small-again"}\n',
  });
  assert.equal(contentForLocalSearch(recovered.state), '{"state":"small-again"}\n');
});

test("file-content state validation rejects unknown and impossible discriminated states", () => {
  for (const state of [
    { status: "unloaded" },
    { status: "loading" },
    { status: "loaded", content: "" },
    { status: "too-large" },
    { status: "failed", error: CONTENT_LOAD_FAILURE },
  ]) {
    assert.equal(isFileContentState(state), true);
  }

  assert.equal(isFileContentState({ status: "future" }), false);
  assert.equal(isFileContentState({ status: "loaded", content: 42 }), false);
  assert.equal(
    isFileContentState({ status: "loaded", content: "body", error: "impossible" }),
    false,
  );
  assert.equal(isFileContentState({ status: "too-large", content: "must not exist" }), false);
  assert.equal(
    isFileContentState({ status: "failed", error: CONTENT_LOAD_FAILURE, content: "body" }),
    false,
  );
});

test("malformed status polling retains last good content while known failures stay typed", () => {
  const previous = { status: "loaded", content: "last good" } as const;
  const malformed = contentStateAfterPathStatusFailure(previous, new ApiResponseValidationError());
  assert.equal(malformed, previous);

  const tooLarge = contentStateAfterPathStatusFailure(
    previous,
    Object.assign(new Error("bounded"), { code: SOURCE_TOO_LARGE_CODE }),
  );
  assert.deepEqual(tooLarge, { status: "too-large" });
  assert.deepEqual(contentStateAfterPathStatusFailure(previous, new Error("network")), {
    status: "failed",
    error: CONTENT_LOAD_FAILURE,
  });
});

test("a malformed reload response becomes a bounded failed state, never a successful refresh", async () => {
  const result = await settleFileContent(file("data.json", "generic-json"), async () => {
    throw new ApiResponseValidationError();
  });

  assert.deepEqual(result.state, { status: "failed", error: CONTENT_LOAD_FAILURE });
  assert.equal(contentForLocalSearch(result.state), null);
  assert.equal(JSON.stringify(result).includes("invalid-api-response"), false);
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
