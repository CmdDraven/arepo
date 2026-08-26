import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { makeTestTempDir } from "./testTemp.js";
import {
  atomicWriteFile,
  buildVaultIndex,
  buildVaultIndexFromInputs,
  captureStructuralIndexInputs,
  createVaultFile,
  DEFAULT_MAX_CONCURRENT_MARKDOWN_READS,
  discoverStructuralIndexSources,
  hashContent,
  deleteVaultFile,
  listSupportedTextFiles,
  processStructuralIndexSources,
  readVaultFile,
  renameVaultPath,
  writeVaultFile,
} from "./vaultFs.js";
import { renderMarkdown } from "../src/lib/vault/render.js";
import { buildGraph } from "../src/lib/vault/graph.js";
import { PublicApiError } from "./publicApiError.js";
import type { VaultInfo } from "./types.js";

async function makeVault(t: TestContext): Promise<VaultInfo> {
  const rootPath = await makeTestTempDir(t, "arepo-vault-");
  return {
    id: "test",
    displayName: "Test",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: true,
    },
  };
}

async function assertFolderRenameRejectedAtomically(
  vault: VaultInfo,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(vault.rootPath, "source", relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }

  await assert.rejects(
    () => renameVaultPath(vault, "source", "destination/renamed", "folder"),
    /folder contains read-only source content/,
  );

  await fs.access(path.join(vault.rootPath, "source"));
  for (const [relativePath, content] of Object.entries(files)) {
    assert.equal(
      await fs.readFile(path.join(vault.rootPath, "source", relativePath), "utf8"),
      content,
    );
  }
  await assert.rejects(() => fs.access(path.join(vault.rootPath, "destination")), /ENOENT/);
}

test("reads and writes files inside the vault root", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "Notes/a.md", "# A\n");
  const before = await readVaultFile(vault, "Notes/a.md");
  assert.equal(before.content, "# A\n");
  const written = await writeVaultFile(vault, "Notes/a.md", "# A2\n");
  assert.equal(written.path, "Notes/a.md");
  const after = await readVaultFile(vault, "Notes/a.md");
  assert.equal(after.content, "# A2\n");
  assert.equal(written.hash, after.hash);
});

test("discovers and reads supported UTF-8 source files with explicit kinds", async (t) => {
  const vault = await makeVault(t);
  await fs.writeFile(
    path.join(vault.rootPath, "z.txt"),
    "Zażółć gęślą jaźń — こんにちは\n",
    "utf8",
  );
  await fs.writeFile(path.join(vault.rootPath, "A.TXT"), "UPPER\n", "utf8");
  await fs.writeFile(path.join(vault.rootPath, "note.md"), "# Note\n", "utf8");
  await fs.writeFile(
    path.join(vault.rootPath, "conversation.arepo-chat.json"),
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"conv"},"messages":[]}\n',
    "utf8",
  );
  await fs.writeFile(
    path.join(vault.rootPath, "session.AREPO-CHAT.JSON"),
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"upper"},"messages":[]}\n',
    "utf8",
  );
  await fs.writeFile(path.join(vault.rootPath, "ignored.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(vault.rootPath, "ignored.chat.json"), "{}\n", "utf8");

  const files = await listSupportedTextFiles(vault);
  assert.deepEqual(
    files.map(({ path: filePath, kind }) => ({ path: filePath, kind })),
    [
      { path: "A.TXT", kind: "plain-text" },
      { path: "conversation.arepo-chat.json", kind: "chat-json" },
      { path: "note.md", kind: "markdown" },
      { path: "session.AREPO-CHAT.JSON", kind: "chat-json" },
      { path: "z.txt", kind: "plain-text" },
    ],
  );
  const plain = await readVaultFile(vault, "z.txt");
  assert.equal(plain.kind, "plain-text");
  assert.equal(plain.content, "Zażółć gęślą jaźń — こんにちは\n");
  const chat = await readVaultFile(vault, "conversation.arepo-chat.json");
  assert.equal(chat.kind, "chat-json");
  assert.match(chat.content, /arepo-chat-export/);
});

test("supported discovery ignores symlinked chat sources", async (t) => {
  const vault = await makeVault(t);
  const outside = await makeTestTempDir(t, "arepo-chat-outside-");
  const outsideFile = path.join(outside, "outside.arepo-chat.json");
  await fs.writeFile(outsideFile, "{}\n", "utf8");
  try {
    await fs.symlink(outsideFile, path.join(vault.rootPath, "linked.arepo-chat.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks unavailable");
      return;
    }
    throw error;
  }

  assert.deepEqual(await listSupportedTextFiles(vault), []);
});

test("plain-text files cannot be created, written, renamed, or deleted", async (t) => {
  const vault = await makeVault(t);
  await fs.writeFile(path.join(vault.rootPath, "read-only.txt"), "disk content\n", "utf8");

  await assert.rejects(() => createVaultFile(vault, "new.txt", "nope\n"), /\.md/);
  await assert.rejects(() => writeVaultFile(vault, "read-only.txt", "nope\n"), /\.md/);
  await assert.rejects(
    () => renameVaultPath(vault, "read-only.txt", "renamed.txt", "file"),
    /\.md/,
  );
  await assert.rejects(() => deleteVaultFile(vault, "read-only.txt"), /\.md/);
  assert.equal(
    await fs.readFile(path.join(vault.rootPath, "read-only.txt"), "utf8"),
    "disk content\n",
  );
});

test("chat sources cannot be created, written, renamed, or deleted", async (t) => {
  const vault = await makeVault(t);
  const sourcePath = path.join(vault.rootPath, "conversation.arepo-chat.json");
  const source =
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"conv"},"messages":[]}\n';
  await fs.writeFile(sourcePath, source, "utf8");

  await assert.rejects(() => createVaultFile(vault, "new.arepo-chat.json", source), /\.md/);
  await assert.rejects(() => writeVaultFile(vault, "conversation.arepo-chat.json", source), /\.md/);
  await assert.rejects(
    () => renameVaultPath(vault, "conversation.arepo-chat.json", "renamed.arepo-chat.json", "file"),
    /\.md/,
  );
  await assert.rejects(() => deleteVaultFile(vault, "conversation.arepo-chat.json"), /\.md/);
  assert.equal(await fs.readFile(sourcePath, "utf8"), source);
});

test("folder rename succeeds when supported descendants are all mutable Markdown", async (t) => {
  const vault = await makeVault(t);
  await fs.mkdir(path.join(vault.rootPath, "source", "nested"), { recursive: true });
  await fs.writeFile(path.join(vault.rootPath, "source", "note.md"), "# Note\n", "utf8");
  await fs.writeFile(
    path.join(vault.rootPath, "source", "nested", "other.MD"),
    "# Other\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(vault.rootPath, "source", "nested", "attachment.bin"),
    "attachment\n",
    "utf8",
  );

  await renameVaultPath(vault, "source", "destination/renamed", "folder");

  await assert.rejects(() => fs.access(path.join(vault.rootPath, "source")), /ENOENT/);
  assert.equal(
    await fs.readFile(path.join(vault.rootPath, "destination", "renamed", "note.md"), "utf8"),
    "# Note\n",
  );
  assert.equal(
    await fs.readFile(
      path.join(vault.rootPath, "destination", "renamed", "nested", "other.MD"),
      "utf8",
    ),
    "# Other\n",
  );
  assert.equal(
    await fs.readFile(
      path.join(vault.rootPath, "destination", "renamed", "nested", "attachment.bin"),
      "utf8",
    ),
    "attachment\n",
  );
});

test("folder rename rejects a direct plain-text descendant atomically", async (t) => {
  await assertFolderRenameRejectedAtomically(await makeVault(t), {
    "read-only.txt": "plain\n",
  });
});

test("folder rename rejects a direct chat-json descendant atomically", async (t) => {
  await assertFolderRenameRejectedAtomically(await makeVault(t), {
    "conversation.arepo-chat.json": '{"format":"arepo-chat-export"}\n',
  });
});

test("folder rename rejects mixed Markdown and plain-text descendants atomically", async (t) => {
  await assertFolderRenameRejectedAtomically(await makeVault(t), {
    "note.md": "# Note\n",
    "read-only.txt": "plain\n",
  });
});

test("folder rename rejects mixed Markdown and chat-json descendants atomically", async (t) => {
  await assertFolderRenameRejectedAtomically(await makeVault(t), {
    "note.md": "# Note\n",
    "conversation.arepo-chat.json": '{"format":"arepo-chat-export"}\n',
  });
});

test("folder rename rejects a deeply nested immutable source atomically", async (t) => {
  await assertFolderRenameRejectedAtomically(await makeVault(t), {
    "note.md": "# Note\n",
    "one/two/three/read-only.txt": "deep plain text\n",
  });
});

test("rejects stale writes when the file changed on disk", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "a.md", "# A\n");
  const before = await readVaultFile(vault, "a.md");
  await writeVaultFile(vault, "a.md", "# External\n");
  await assert.rejects(
    () =>
      writeVaultFile(vault, "a.md", "# User edit\n", {
        expectedHash: before.hash,
        expectedMtimeMs: before.mtimeMs,
      }),
    /changed on disk/,
  );
});

test("serializes optimistic writes so only one writer can consume a file version", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "a.md", "# Original\n");
  const before = await readVaultFile(vault, "a.md");

  const results = await Promise.allSettled([
    writeVaultFile(vault, "a.md", "# Writer A\n", {
      expectedHash: before.hash,
      expectedMtimeMs: before.mtimeMs,
    }),
    writeVaultFile(vault, "a.md", "# Writer B\n", {
      expectedHash: before.hash,
      expectedMtimeMs: before.mtimeMs,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected?.status, "rejected");
  if (rejected?.status === "rejected") assert.match(String(rejected.reason), /changed on disk/);
  assert.match((await readVaultFile(vault, "a.md")).content, /^# Writer [AB]\n$/);
});

test("atomic writes clean temporary files when the final rename fails", async (t) => {
  const vault = await makeVault(t);
  const target = path.join(vault.rootPath, "occupied.md");
  await fs.mkdir(target);

  await assert.rejects(() => atomicWriteFile(target, "# Cannot replace a directory\n"));

  const entries = await fs.readdir(vault.rootPath);
  assert.equal(
    entries.some((entry) => entry.startsWith(".occupied.md.") && entry.endsWith(".tmp")),
    false,
  );
});

test("rejects files outside the vault root", async (t) => {
  const vault = await makeVault(t);
  await assert.rejects(() => readVaultFile(vault, "../x.md"), /cannot be/);
});

test("backend index reports duplicate ids, duplicate anchors, broken links, and orphans", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(
    vault,
    "a.md",
    "---\nid: same\ntitle: A\n---\n# A\n\n## One {#dup}\n## Two {#dup}\n[[missing]]\n",
  );
  await createVaultFile(vault, "b.md", "---\nid: same\ntitle: B\n---\n# B\n[[a]]\n");
  await createVaultFile(vault, "c.md", "---\nid: c\ntitle: C\n---\n# C\n");

  const { index, issues } = await buildVaultIndex(vault);
  assert.equal(index.notes["a.md"]?.title, "A");
  assert.deepEqual(index.orphanNotes, ["c.md"]);
  assert.equal(index.brokenLinks[0]?.target, "missing");
  assert.ok(issues.some((issue) => issue.kind === "duplicate-id"));
  assert.ok(issues.some((issue) => issue.kind === "duplicate-anchor"));
  assert.ok(issues.some((issue) => issue.kind === "broken-wikilink"));
});

test("structural source reads preserve ordering under a configured concurrency bound", async (t) => {
  const vault = await makeVault(t);
  const sourceCount = DEFAULT_MAX_CONCURRENT_MARKDOWN_READS + 5;
  for (let index = 0; index < sourceCount; index += 1) {
    await createVaultFile(vault, `source-${String(index).padStart(2, "0")}.md`, `# ${index}\n`);
  }

  const captureAtConcurrency = async (expectedConcurrency: number) => {
    let active = 0;
    let highWater = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inputs = await captureStructuralIndexInputs(vault, {
      maxConcurrentMarkdownReads: expectedConcurrency,
      beforeSourceBodyRead: async () => {
        active += 1;
        highWater = Math.max(highWater, active);
        if (active === expectedConcurrency) release();
        await gate;
        active -= 1;
      },
    });
    return { highWater, inputs };
  };

  const defaultCapture = await captureAtConcurrency(DEFAULT_MAX_CONCURRENT_MARKDOWN_READS);

  assert.equal(defaultCapture.highWater, DEFAULT_MAX_CONCURRENT_MARKDOWN_READS);
  const configuredCapture = await captureAtConcurrency(3);

  assert.equal(configuredCapture.highWater, 3);
  const expectedPaths = Array.from(
    { length: sourceCount },
    (_, index) => `source-${String(index).padStart(2, "0")}.md`,
  );
  assert.deepEqual(
    defaultCapture.inputs.manifest.sources.map((source) => source.path),
    expectedPaths,
  );
  assert.deepEqual(
    configuredCapture.inputs.manifest.sources.map((source) => source.path),
    expectedPaths,
  );
});

test("structural capture rejects parent replacement after validation without reading outside content", async (t) => {
  const vault = await makeVault(t);
  const outside = await makeTestTempDir(t, "arepo-vault-race-outside-");
  const parent = path.join(vault.rootPath, "parent");
  const originalParent = path.join(vault.rootPath, "parent-original");
  await fs.mkdir(parent);
  await fs.writeFile(path.join(parent, "note.md"), "# Safe Inside\n", "utf8");
  await fs.writeFile(
    path.join(outside, "note.md"),
    "---\ntitle: Outside Race Target\ntags: [outside-marker]\n---\n# Outside\n",
    "utf8",
  );

  let changed = false;
  let bodyReads = 0;
  let handlesOpened = 0;
  let handlesClosed = 0;
  const inputs = await captureStructuralIndexInputs(vault, {
    afterSourcePathValidated: async (sourcePath) => {
      if (sourcePath !== "parent/note.md" || changed) return;
      changed = true;
      await fs.rename(parent, originalParent);
      try {
        await fs.symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          t.skip("directory symlinks unavailable");
          return;
        }
        throw error;
      }
    },
    onMarkdownBodyRead: () => {
      bodyReads += 1;
    },
    onSourceHandleOpened: () => {
      handlesOpened += 1;
    },
    onSourceHandleClosed: () => {
      handlesClosed += 1;
    },
  });
  const result = buildVaultIndexFromInputs(inputs);

  assert.equal(changed, true);
  assert.equal(bodyReads, 0);
  assert.equal(handlesOpened, 1);
  assert.equal(handlesClosed, 1);
  assert.deepEqual(result.index.notes, {});
  assert.deepEqual(inputs.manifest.sources, [{ path: "parent/note.md", state: "unavailable" }]);
  const serialized = JSON.stringify(result);
  for (const hidden of [outside, vault.rootPath, "Outside Race Target", "outside-marker"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test("structural capture rejects leaf replacement after validation before any body read", async (t) => {
  const vault = await makeVault(t);
  const note = path.join(vault.rootPath, "note.md");
  await fs.writeFile(note, "# Validated Source\n", "utf8");
  let bodyReads = 0;

  const inputs = await captureStructuralIndexInputs(vault, {
    afterSourcePathValidated: async () => {
      await fs.rename(note, path.join(vault.rootPath, "validated-original.md"));
      await fs.writeFile(note, "# Substituted Body\n", "utf8");
    },
    onMarkdownBodyRead: () => {
      bodyReads += 1;
    },
  });

  assert.equal(bodyReads, 0);
  assert.deepEqual(inputs.readableFiles, {});
  assert.deepEqual(inputs.manifest.sources, [{ path: "note.md", state: "unavailable" }]);
  assert.equal(JSON.stringify(inputs).includes("Substituted Body"), false);
});

test("structural capture rejects leaf replacement with a symlink", async (t) => {
  const vault = await makeVault(t);
  const outside = await makeTestTempDir(t, "arepo-vault-leaf-race-");
  const note = path.join(vault.rootPath, "note.md");
  const outsideNote = path.join(outside, "outside.md");
  await fs.writeFile(note, "# Validated Source\n", "utf8");
  await fs.writeFile(outsideNote, "# Outside Symlink Target\n", "utf8");
  let bodyReads = 0;

  const inputs = await captureStructuralIndexInputs(vault, {
    afterSourcePathValidated: async () => {
      await fs.unlink(note);
      try {
        await fs.symlink(outsideNote, note, "file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          t.skip("file symlinks unavailable");
          return;
        }
        throw error;
      }
    },
    onMarkdownBodyRead: () => {
      bodyReads += 1;
    },
  });

  assert.equal(bodyReads, 0);
  assert.deepEqual(inputs.readableFiles, {});
  assert.equal(JSON.stringify(inputs).includes("Outside Symlink Target"), false);
});

test("structural capture rejects a leaf that becomes a directory", async (t) => {
  const vault = await makeVault(t);
  const note = path.join(vault.rootPath, "note.md");
  await fs.writeFile(note, "# Validated Source\n", "utf8");
  let bodyReads = 0;

  const inputs = await captureStructuralIndexInputs(vault, {
    afterSourcePathValidated: async () => {
      await fs.unlink(note);
      await fs.mkdir(note);
    },
    onMarkdownBodyRead: () => {
      bodyReads += 1;
    },
  });

  assert.equal(bodyReads, 0);
  assert.deepEqual(inputs.readableFiles, {});
  assert.deepEqual(inputs.manifest.sources, [{ path: "note.md", state: "unavailable" }]);
});

test("an opened and identity-verified source is not redirected by later pathname replacement", async (t) => {
  const vault = await makeVault(t);
  const note = path.join(vault.rootPath, "note.md");
  await fs.writeFile(note, "# Opened Safe Source\n", "utf8");
  let verified = 0;

  const inputs = await captureStructuralIndexInputs(vault, {
    afterSourceIdentityVerified: async () => {
      verified += 1;
      await fs.rename(note, path.join(vault.rootPath, "opened-original.md"));
      await fs.writeFile(note, "# Later Path Replacement\n", "utf8");
    },
  });

  assert.equal(verified, 1);
  assert.equal(inputs.readableFiles["note.md"], "# Opened Safe Source\n");
  assert.equal(JSON.stringify(inputs).includes("Later Path Replacement"), false);
});

test("normal structural reads verify identity before body read and close every handle", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "note.md", "# Note\n");
  const events: string[] = [];

  const inputs = await captureStructuralIndexInputs(vault, {
    afterSourcePathValidated: () => {
      events.push("validated");
    },
    onSourceHandleOpened: () => events.push("opened"),
    onSourceHandleStat: () => events.push("fstat"),
    afterSourceIdentityVerified: () => {
      events.push("identity");
    },
    onMarkdownBodyRead: () => events.push("read"),
    onSourceHandleClosed: () => events.push("closed"),
  });

  assert.equal(inputs.readableFiles["note.md"], "# Note\n");
  assert.deepEqual(events, ["validated", "opened", "fstat", "identity", "read", "closed"]);
});

test("structural identity verification hashes the exact bytes read from the handle", async (t) => {
  const vault = await makeVault(t);
  const body = Buffer.from([0x23, 0x20, 0xff, 0x0a]);
  await fs.writeFile(path.join(vault.rootPath, "note.md"), body);

  const inputs = await captureStructuralIndexInputs(vault);
  const source = inputs.manifest.sources[0];

  assert.equal(source?.state, "readable");
  assert.equal(
    source?.state === "readable" ? source.contentHash : undefined,
    crypto.createHash("sha256").update(body).digest("hex"),
  );
  assert.notEqual(
    source?.state === "readable" ? source.contentHash : undefined,
    hashContent(inputs.readableFiles["note.md"]!),
  );
});

test("Markdown, plain-text, and chat reads reject leaf substitution through the shared reader", async (t) => {
  const vault = await makeVault(t);
  const fixtures = [
    ["note.md", "# Original Markdown\n", "# Substituted Markdown\n"],
    ["note.txt", "Original plain text\n", "Substituted plain text\n"],
    [
      "note.arepo-chat.json",
      '{"format":"arepo-chat-export","version":1,"messages":[]}\n',
      '{"format":"arepo-chat-export","version":1,"messages":[{"content":"substituted"}]}\n',
    ],
  ] as const;
  for (const [sourcePath, original, substituted] of fixtures) {
    await fs.writeFile(path.join(vault.rootPath, sourcePath), original, "utf8");
    const absolutePath = path.join(vault.rootPath, sourcePath);
    const originalOpen = fs.open;
    let replaced = false;
    fs.open = (async (file, ...args) => {
      if (file === absolutePath && !replaced) {
        replaced = true;
        await fs.rename(absolutePath, `${absolutePath}.validated`);
        await fs.writeFile(absolutePath, substituted, "utf8");
      }
      return originalOpen(file, ...args);
    }) as typeof fs.open;
    try {
      await assert.rejects(
        () => readVaultFile(vault, sourcePath),
        (error: PublicApiError) =>
          error.publicMessage === "Vault source changed while being read" &&
          !error.publicMessage.includes(vault.rootPath) &&
          !error.publicMessage.includes(substituted),
      );
    } finally {
      fs.open = originalOpen;
    }
    assert.equal(replaced, true);
  }
});

test("verified source handles close on fstat, body-read, and downstream failures", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "note.md", "# Note\n");
  const discovery = await discoverStructuralIndexSources(vault);
  const notePath = path.join(vault.rootPath, "note.md");
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });

  for (const stage of ["fstat", "read"] as const) {
    let opened = 0;
    let closed = 0;
    fs.open = (async (file, ...args) => {
      const handle = await originalOpen(file, ...args);
      if (file === notePath) {
        if (stage === "fstat") {
          Object.defineProperty(handle, "stat", {
            configurable: true,
            value: async () => {
              throw Object.assign(new Error("injected fstat failure"), { code: "EIO" });
            },
          });
        } else {
          Object.defineProperty(handle, "readFile", {
            configurable: true,
            value: async () => {
              throw Object.assign(new Error("injected body failure"), { code: "EIO" });
            },
          });
        }
      }
      return handle;
    }) as typeof fs.open;
    const result = await processStructuralIndexSources(discovery, ({ content }) => content, {
      onSourceHandleOpened: () => {
        opened += 1;
      },
      onSourceHandleClosed: () => {
        closed += 1;
      },
    });
    assert.deepEqual(result.manifest.sources, [{ path: "note.md", state: "unavailable" }]);
    assert.equal(opened, 1);
    assert.equal(closed, 1);
  }

  fs.open = originalOpen;
  let opened = 0;
  let closed = 0;
  await assert.rejects(
    () =>
      processStructuralIndexSources(discovery, ({ content }) => content, {
        onSourceHandleOpened: () => {
          opened += 1;
        },
        onSourceHandleClosed: () => {
          closed += 1;
        },
        onHashCalculated: () => {
          throw new Error("hash instrumentation failure");
        },
      }),
    /hash instrumentation failure/,
  );
  assert.equal(opened, 1);
  assert.equal(closed, 1);

  opened = 0;
  closed = 0;
  await assert.rejects(
    () =>
      processStructuralIndexSources(
        discovery,
        () => {
          throw new Error("downstream invariant failure");
        },
        {
          onSourceHandleOpened: () => {
            opened += 1;
          },
          onSourceHandleClosed: () => {
            closed += 1;
          },
        },
      ),
    /downstream invariant failure/,
  );
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

test("streamed structural processing releases bodies and normalizes adversarial completion order", async (t) => {
  const vault = await makeVault(t);
  for (let index = 0; index < 4; index += 1) {
    await createVaultFile(vault, `ordered-${index}.md`, `# Ordered ${index}\n`);
  }
  const discovery = await discoverStructuralIndexSources(vault);
  const releases = new Map<string, () => void>();
  let started = 0;
  let notifyStarted!: () => void;
  const allStarted = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const pauseBodyRead = async (sourcePath: string) => {
    started += 1;
    if (started === 4) notifyStarted();
    await new Promise<void>((resolve) => {
      releases.set(path.basename(sourcePath), resolve);
    });
  };

  let liveBodies = 0;
  let peakBodies = 0;
  const processing = processStructuralIndexSources(
    discovery,
    ({ path: sourcePath }) => sourcePath,
    {
      maxConcurrentMarkdownReads: 4,
      beforeSourceBodyRead: pauseBodyRead,
      onMarkdownBodyRetained: () => {
        liveBodies += 1;
        peakBodies = Math.max(peakBodies, liveBodies);
      },
      onMarkdownBodyReleased: () => {
        liveBodies -= 1;
      },
    },
  );
  await allStarted;
  for (const file of ["ordered-3.md", "ordered-2.md", "ordered-1.md", "ordered-0.md"]) {
    releases.get(file)?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const result = await processing;

  assert.equal(liveBodies, 0);
  assert.ok(peakBodies <= 4);
  assert.deepEqual(
    result.processedSources.map(({ path: sourcePath }) => sourcePath),
    ["ordered-0.md", "ordered-1.md", "ordered-2.md", "ordered-3.md"],
  );
  assert.deepEqual(
    result.manifest.sources.map(({ path: sourcePath }) => sourcePath),
    ["ordered-0.md", "ordered-1.md", "ordered-2.md", "ordered-3.md"],
  );
});

test("streamed structural processing balances body accounting for source-local and global failures", async (t) => {
  const vault = await makeVault(t);
  for (const sourcePath of ["failure.md", "good-a.md", "good-b.md", "good-c.md"]) {
    await createVaultFile(vault, sourcePath, `# ${sourcePath}\n`);
  }
  const discovery = await discoverStructuralIndexSources(vault);
  let retained = 0;
  let released = 0;

  const partial = await processStructuralIndexSources(
    discovery,
    ({ path: sourcePath }) => sourcePath,
    {
      maxConcurrentMarkdownReads: 2,
      beforeSourceBodyRead: (sourcePath) => {
        if (sourcePath === "failure.md") {
          throw Object.assign(new Error("source-local"), { code: "EIO" });
        }
      },
      onMarkdownBodyRetained: () => {
        retained += 1;
      },
      onMarkdownBodyReleased: () => {
        released += 1;
      },
    },
  );
  assert.equal(retained, 3);
  assert.equal(released, 3);
  assert.deepEqual(
    partial.manifest.sources.find(({ path: sourcePath }) => sourcePath === "failure.md"),
    { path: "failure.md", state: "unavailable" },
  );

  let readStarts = 0;
  let readSettles = 0;
  retained = 0;
  released = 0;
  await assert.rejects(
    () =>
      processStructuralIndexSources(discovery, ({ path: sourcePath }) => sourcePath, {
        maxConcurrentMarkdownReads: 2,
        beforeSourceBodyRead: async (sourcePath) => {
          if (sourcePath === "failure.md") {
            throw Object.assign(new Error("global exhaustion"), { code: "EMFILE" });
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
        },
        onMarkdownBodyRead: () => {
          readStarts += 1;
        },
        onMarkdownBodyReadSettled: () => {
          readSettles += 1;
        },
        onMarkdownBodyRetained: () => {
          retained += 1;
        },
        onMarkdownBodyReleased: () => {
          released += 1;
        },
      }),
    /global exhaustion/,
  );
  assert.equal(readStarts, 2);
  assert.equal(readSettles, 2);
  assert.equal(retained, released);
});

test("structural indexing isolates one path-bearing Markdown read failure", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(
    vault,
    "good-a.md",
    "---\nid: shared-id\ntitle: Good A\ntags: [readable]\n---\n# Good A\n\n[[unreadable-or-failing]]\n",
  );
  await createVaultFile(
    vault,
    "unreadable-or-failing.md",
    "---\nid: shared-id\ntitle: Hidden\ntags: [must-not-appear]\n---\n# Hidden Heading {#hidden-anchor}\n\n[[good-b]]\n",
  );
  await createVaultFile(
    vault,
    "good-b.md",
    "---\nid: good-b\ntitle: Good B\ntags: [readable]\n---\n# Good B\n",
  );
  await fs.writeFile(path.join(vault.rootPath, "plain.txt"), "# Not Markdown\n", "utf8");
  await fs.writeFile(
    path.join(vault.rootPath, "conversation.arepo-chat.json"),
    '{"format":"arepo-chat-export","version":1,"messages":[]}',
    "utf8",
  );
  await fs.writeFile(path.join(vault.rootPath, "attachment.bin"), "ignored", "utf8");
  const failedPath = path.join(vault.rootPath, "unreadable-or-failing.md");
  const sensitivePath = "/private/example/secret-vault/unreadable-or-failing.md";
  const rawMessage = `EACCES: permission denied, open '${sensitivePath}'`;
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === failedPath) {
      throw Object.assign(new Error(rawMessage), {
        code: "EACCES",
        errno: -13,
        syscall: "open",
        path: sensitivePath,
      });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const result = await buildVaultIndex(vault);

  assert.deepEqual(Object.keys(result.index.notes), ["good-a.md", "good-b.md"]);
  assert.deepEqual(result.index.byId, { "shared-id": "good-a.md", "good-b": "good-b.md" });
  assert.deepEqual(result.index.duplicateIds, {});
  assert.equal(
    Object.values(result.index.notes).some(
      (note) => note.tags.includes("must-not-appear") || note.anchors.includes("hidden-anchor"),
    ),
    false,
  );
  assert.deepEqual(
    result.issues.filter((issue) => issue.kind === "source-unreadable"),
    [
      {
        kind: "source-unreadable",
        path: "unreadable-or-failing.md",
        message: "Source file could not be read.",
        severity: "error",
      },
    ],
  );
  const link = result.index.outgoingLinks["good-a.md"]?.[0];
  assert.equal(link?.status, "missing");
  assert.equal(link?.broken, true);
  assert.equal(result.index.brokenLinks[0]?.target, "unreadable-or-failing");
  const serialized = JSON.stringify(result);
  for (const hidden of [
    sensitivePath,
    vault.rootPath,
    rawMessage,
    "EACCES",
    "EPERM",
    "permission denied",
    "errno",
    "syscall",
    "stack",
  ]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test("structural indexing isolates a source that disappears after discovery", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "good.md", "---\nid: good\ntitle: Good\n---\n# Good\n");
  await createVaultFile(vault, "gone.md", "---\nid: gone\ntitle: Gone\n---\n# Gone\n");
  const gonePath = path.join(vault.rootPath, "gone.md");
  const originalOpen = fs.open;
  let removed = false;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === gonePath && !removed) {
      removed = true;
      await fs.unlink(gonePath);
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const result = await buildVaultIndex(vault);

  assert.deepEqual(Object.keys(result.index.notes), ["good.md"]);
  assert.deepEqual(
    result.issues.filter((issue) => issue.kind === "source-unreadable"),
    [
      {
        kind: "source-unreadable",
        path: "gone.md",
        message: "Source file could not be read.",
        severity: "error",
      },
    ],
  );
});

test("multiple source read failures produce stable ordered issues", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "z-failed.md", "# Z\n");
  await createVaultFile(
    vault,
    "readable.md",
    "---\nid: readable\ntitle: Readable\n---\n# Readable\n",
  );
  await createVaultFile(vault, "a-failed.md", "# A\n");
  const failedPaths = new Set([
    path.join(vault.rootPath, "a-failed.md"),
    path.join(vault.rootPath, "z-failed.md"),
  ]);
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (typeof file === "string" && failedPaths.has(file)) {
      throw Object.assign(new Error("injected failure"), { code: "EIO" });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const result = await buildVaultIndex(vault);

  assert.deepEqual(Object.keys(result.index.notes), ["readable.md"]);
  assert.deepEqual(
    result.issues.filter((issue) => issue.kind === "source-unreadable").map((issue) => issue.path),
    ["a-failed.md", "z-failed.md"],
  );
});

test("a recovered source returns to the next structural index without a stale issue", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "good.md", "---\nid: good\ntitle: Good\n---\n# Good\n");
  await createVaultFile(
    vault,
    "recovered.md",
    "---\nid: recovered\ntitle: Recovered\ntags: [restored]\n---\n# Recovered\n\n## Returned {#returned}\n",
  );
  const recoveredPath = path.join(vault.rootPath, "recovered.md");
  const originalOpen = fs.open;
  let failing = true;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === recoveredPath && failing) {
      throw Object.assign(new Error("transient read failure"), { code: "EIO" });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const partial = await buildVaultIndex(vault);
  assert.equal(partial.index.notes["recovered.md"], undefined);
  assert.ok(partial.issues.some((issue) => issue.kind === "source-unreadable"));

  failing = false;
  const recovered = await buildVaultIndex(vault);
  assert.equal(recovered.index.notes["recovered.md"]?.title, "Recovered");
  assert.deepEqual(recovered.index.notes["recovered.md"]?.tags, ["restored"]);
  assert.ok(recovered.index.notes["recovered.md"]?.anchors.includes("returned"));
  assert.equal(
    recovered.issues.some((issue) => issue.kind === "source-unreadable"),
    false,
  );
});

test("vault-wide source enumeration failures remain global", async (t) => {
  const vault = await makeVault(t);
  await fs.rm(vault.rootPath, { recursive: true });

  await assert.rejects(() => buildVaultIndex(vault));
});

test("unexpected non-filesystem source failures remain global", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "note.md", "# Note\n");
  const notePath = path.join(vault.rootPath, "note.md");
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === notePath) throw new Error("unexpected invariant failure");
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  await assert.rejects(() => buildVaultIndex(vault), /unexpected invariant failure/);
});

test("resource-exhaustion and unknown filesystem codes remain global", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "note.md", "# Note\n");
  const notePath = path.join(vault.rootPath, "note.md");
  const originalOpen = fs.open;
  let injectedCode = "EMFILE";
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === notePath) {
      throw Object.assign(new Error(`injected ${injectedCode} failure`), {
        code: injectedCode,
      });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  for (const code of ["EBADF", "EMFILE", "ENFILE", "ENOSPC", "UNKNOWN"]) {
    injectedCode = code;
    await assert.rejects(
      () => buildVaultIndex(vault),
      (error: NodeJS.ErrnoException) => error.code === code,
    );
  }
});

test("unrelated public API errors are not classified as source-unreadable", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "note.md", "# Note\n");
  const notePath = path.join(vault.rootPath, "note.md");
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === notePath) {
      throw new PublicApiError(400, "Unrelated public invariant", {
        code: "invalid-vault-operation",
      });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  await assert.rejects(() => buildVaultIndex(vault), /Unrelated public invariant/);
});

test("structural indexes exclude source bodies", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(
    vault,
    "secret.md",
    "---\nid: secret\ntitle: Secret\n---\n# Secret\n\nbody-only-token\n",
  );

  const result = await buildVaultIndex(vault);

  assert.equal(Object.hasOwn(result.index.notes["secret.md"] ?? {}, "body"), false);
  assert.equal(JSON.stringify(result).includes("body-only-token"), false);
});

test("Markdown indexing ignores plain-text files and their contents", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "note.md", "---\nid: note\ntitle: Note\n---\n# Note\n");
  await fs.writeFile(
    path.join(vault.rootPath, "plain.txt"),
    "plain-only-secret [[missing-from-plain]]\n",
    "utf8",
  );

  const result = await buildVaultIndex(vault);
  assert.deepEqual(Object.keys(result.index.notes), ["note.md"]);
  assert.equal(JSON.stringify(result).includes("plain-only-secret"), false);
  assert.equal(JSON.stringify(result).includes("missing-from-plain"), false);
});

test("Markdown indexing ignores chat sources and message contents", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "note.md", "---\nid: note\ntitle: Note\n---\n# Note\n");
  await fs.writeFile(
    path.join(vault.rootPath, "conversation.arepo-chat.json"),
    JSON.stringify({
      format: "arepo-chat-export",
      version: 1,
      conversation: { id: "conv", title: "chat-index-secret" },
      messages: [
        {
          id: "msg",
          author: "Alice",
          timestamp: "2026-08-24T10:00:00Z",
          text: "chat-body-secret [[not-a-markdown-link]]",
        },
      ],
    }),
    "utf8",
  );

  const result = await buildVaultIndex(vault);
  assert.deepEqual(Object.keys(result.index.notes), ["note.md"]);
  assert.equal(JSON.stringify(result).includes("chat-index-secret"), false);
  assert.equal(JSON.stringify(result).includes("chat-body-secret"), false);
  assert.equal(JSON.stringify(result).includes("not-a-markdown-link"), false);
});

test("backend index ignores wikilinks in fenced and inline code", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(
    vault,
    "a.md",
    "---\nid: a\ntitle: A\n---\n# A\n\n```md\n[[missing-in-fence]]\n```\n`[[missing-inline]]`\n[[real-missing]]\n",
  );

  const { index, issues } = await buildVaultIndex(vault);
  assert.deepEqual(
    index.brokenLinks.map((link) => link.target),
    ["real-missing"],
  );
  assert.equal(issues.filter((issue) => issue.kind === "broken-wikilink").length, 1);
});

test("folder-qualified wikilinks resolve from the vault root", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(
    vault,
    "Notes/note.md",
    "---\nid: note-id\ntitle: Note\n---\n# Note\n\n[[Reference/reference-note#terminology]]\n\n## Backlink Target {#backlink-target}\n",
  );
  await createVaultFile(
    vault,
    "Reference/reference-note.md",
    "---\nid: reference-id\ntitle: Reference Note\n---\n# Reference Note\n\n[[Notes/note#backlink-target]]\n\n## Terminology {#terminology}\n",
  );

  const { index, issues } = await buildVaultIndex(vault);
  assert.equal(
    index.outgoingLinks["Notes/note.md"]?.[0]?.targetPath,
    "Reference/reference-note.md",
  );
  assert.equal(
    index.outgoingLinks["Reference/reference-note.md"]?.[0]?.targetPath,
    "Notes/note.md",
  );
  assert.equal(index.backlinks["Reference/reference-note.md"]?.[0]?.fromPath, "Notes/note.md");
  assert.equal(index.backlinks["Notes/note.md"]?.[0]?.fromPath, "Reference/reference-note.md");
  assert.equal(
    issues.some((issue) => issue.kind === "broken-wikilink"),
    false,
  );
  assert.equal(
    issues.some((issue) => issue.kind === "missing-anchor"),
    false,
  );
});

test("repository test-vault indexes core fixture expectations", async (t) => {
  const rootPath = path.resolve(process.cwd(), "test-vault");
  const vault: VaultInfo = {
    id: "repo-test-vault",
    displayName: "Repository Test Vault",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
  };

  const { index, issues } = await buildVaultIndex(vault);

  assert.ok(index.notes["README.md"]);
  assert.ok(index.notes["Notes/note.md"]);
  assert.ok(index.notes["Notes/Nestest/note.md"]);
  assert.ok(index.notes["Reference/reference-note.md"]);
  assert.equal(index.notes["Notes/note.md"]?.frontmatter.id, "note");
  assert.equal(index.notes["Reference/reference-note.md"]?.frontmatter.id, "reference-note");

  const noteLinks = index.outgoingLinks["Notes/note.md"] ?? [];
  assert.ok(
    noteLinks.some(
      (link) =>
        link.target === "Reference/reference-note" &&
        link.targetPath === "Reference/reference-note.md",
    ),
  );
  assert.ok(
    noteLinks.some(
      (link) =>
        link.target === "Reference/reference-note" &&
        link.anchor === "terminology" &&
        link.status === "resolved",
    ),
  );
  assert.ok(
    noteLinks.some(
      (link) =>
        link.target === "Notes/Nestest/note" &&
        link.targetPath === "Notes/Nestest/note.md" &&
        link.status === "resolved",
    ),
  );

  const referenceLinks = index.outgoingLinks["Reference/reference-note.md"] ?? [];
  assert.ok(
    referenceLinks.some(
      (link) => link.target === "Notes/note" && link.targetPath === "Notes/note.md",
    ),
  );
  assert.ok(referenceLinks.some((link) => link.target === "note" && link.status === "resolved"));

  const brokenTargets = index.brokenLinks.map((link) => link.target).sort();
  assert.ok(brokenTargets.includes("Reference/missing-reference"));
  assert.ok(brokenTargets.includes("missing-note"));
  assert.equal(
    index.outgoingLinks["Notes/note.md"]?.find((link) => link.target === "missing-note")?.status,
    "missing",
  );
  assert.equal(
    issues.filter(
      (issue) =>
        issue.kind === "broken-wikilink" &&
        (issue.message.includes("Reference/missing-reference") ||
          issue.message.includes("missing-note")),
    ).length,
    2,
  );

  const allOutgoingTargets = Object.values(index.outgoingLinks)
    .flat()
    .map((link) => link.target);
  assert.equal(
    allOutgoingTargets.some((target) => target.includes("fake")),
    false,
  );
  assert.equal(
    allOutgoingTargets.some((target) => target.includes("inline")),
    false,
  );

  assert.ok(
    (index.backlinks["Notes/note.md"] ?? []).some(
      (backlink) => backlink.fromPath === "Reference/reference-note.md",
    ),
  );
  assert.ok(
    (index.backlinks["Reference/reference-note.md"] ?? []).some(
      (backlink) => backlink.fromPath === "Notes/note.md",
    ),
  );

  const graph = buildGraph(index, issues);
  assert.ok(graph.nodes.some((node) => node.id === "Notes/note.md"));
  assert.ok(graph.nodes.some((node) => node.id === "Reference/reference-note.md"));
  assert.ok(graph.nodes.some((node) => node.id === "missing:missing-note"));
  assert.ok(graph.edges.some((edge) => edge.type === "wikilink"));
  assert.ok(graph.edges.some((edge) => edge.type === "broken"));
});

test("repository test-vault default scope indexes all Markdown depths", async (t) => {
  const rootPath = path.resolve(process.cwd(), "test-vault");
  const vault: VaultInfo = {
    id: "repo-default-scope",
    displayName: "Repository Default Scope",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
  };

  const { index, issues } = await buildVaultIndex(vault);

  assert.deepEqual(Object.keys(index.notes).sort(), [
    "Notes/Nestest/note.md",
    "Notes/note.md",
    "README.md",
    "Reference/reference-note.md",
  ]);
});

test("repository test-vault maxDepth 1 excludes depth 2 Markdown notes", async (t) => {
  const rootPath = path.resolve(process.cwd(), "test-vault");
  const vault: VaultInfo = {
    id: "repo-max-depth-one",
    displayName: "Repository Max Depth One",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
    vaultIndexScope: {
      markdown: {
        minDepth: 0,
        maxDepth: 1,
      },
    },
  };

  const { index, issues } = await buildVaultIndex(vault);

  assert.deepEqual(Object.keys(index.notes).sort(), [
    "Notes/note.md",
    "README.md",
    "Reference/reference-note.md",
  ]);
  assert.equal(index.notes["Notes/Nestest/note.md"], undefined);
  const nestedLink = index.outgoingLinks["Notes/note.md"]?.find(
    (link) => link.target === "Notes/Nestest/note",
  );
  assert.equal(nestedLink?.status, "excluded-by-index-scope");
  assert.equal(nestedLink?.broken, true);
  assert.equal(
    index.brokenLinks.find((link) => link.target === "Notes/Nestest/note")?.status,
    "excluded-by-index-scope",
  );
  assert.equal(
    index.outgoingLinks["Notes/note.md"]?.find((link) => link.target === "missing-note")?.status,
    "missing",
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.kind === "broken-wikilink" &&
        issue.message.includes("outside this vault's Index Scope"),
    ),
  );
  const allOutgoingTargets = Object.values(index.outgoingLinks)
    .flat()
    .map((link) => link.target);
  assert.equal(
    allOutgoingTargets.some((target) => target.includes("fake")),
    false,
  );
  assert.equal(
    allOutgoingTargets.some((target) => target.includes("inline")),
    false,
  );
});

test("repository test-vault exact depth 2 scope only indexes nested Markdown notes", async (t) => {
  const rootPath = path.resolve(process.cwd(), "test-vault");
  const vault: VaultInfo = {
    id: "repo-depth-two",
    displayName: "Repository Depth Two",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
    vaultIndexScope: {
      markdown: {
        minDepth: 2,
        maxDepth: 2,
      },
    },
  };

  const { index } = await buildVaultIndex(vault);

  assert.deepEqual(Object.keys(index.notes), ["Notes/Nestest/note.md"]);
  assert.equal(index.notes["README.md"], undefined);
  assert.equal(index.notes["Notes/note.md"], undefined);
  assert.equal(index.notes["Reference/reference-note.md"], undefined);
});

test("id links resolve before unique filename stems", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(
    vault,
    "Source.md",
    "---\nid: source\ntitle: Source\n---\n# Source\n\n[[reference-note]]\n",
  );
  await createVaultFile(
    vault,
    "Reference/reference-note.md",
    "---\nid: not-the-id\ntitle: Filename Match\n---\n# Filename Match\n",
  );
  await createVaultFile(
    vault,
    "ById.md",
    "---\nid: reference-note\ntitle: ID Match\n---\n# ID Match\n",
  );

  const { index } = await buildVaultIndex(vault);
  assert.equal(index.outgoingLinks["Source.md"]?.[0]?.targetPath, "ById.md");
  assert.equal(index.backlinks["ById.md"]?.[0]?.fromPath, "Source.md");
});

test("frontmatter id links distinguish unique, missing, and duplicate targets", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(
    vault,
    "Source.md",
    "---\nid: source\ntitle: Source\n---\n# Source\n\n[[unique-id]]\n[[duplicate-id]]\n[[missing-id]]\n",
  );
  await createVaultFile(vault, "Unique.md", "---\nid: unique-id\ntitle: Unique\n---\n# Unique\n");
  await createVaultFile(vault, "A.md", "---\nid: duplicate-id\ntitle: A\n---\n# A\n");
  await createVaultFile(vault, "B.md", "---\nid: duplicate-id\ntitle: B\n---\n# B\n");

  const { index, issues } = await buildVaultIndex(vault);
  const links = index.outgoingLinks["Source.md"] ?? [];

  assert.equal(links[0]?.status, "resolved");
  assert.equal(links[0]?.targetPath, "Unique.md");
  assert.equal(links[1]?.status, "ambiguous");
  assert.deepEqual(links[1]?.targetPaths, ["A.md", "B.md"]);
  assert.equal(links[2]?.status, "missing");
  assert.equal(index.byId["duplicate-id"], undefined);
  assert.deepEqual(index.duplicateIds["duplicate-id"], ["A.md", "B.md"]);
  assert.ok(issues.some((issue) => issue.kind === "ambiguous-link"));
});

test("ambiguous filename stems create validation errors", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "Source.md", "# Source\n\n[[topic]]\n");
  await createVaultFile(vault, "A/topic.md", "# Topic A\n");
  await createVaultFile(vault, "B/topic.md", "# Topic B\n");

  const { index, issues } = await buildVaultIndex(vault);
  assert.equal(index.outgoingLinks["Source.md"]?.[0]?.status, "ambiguous");
  assert.ok(issues.some((issue) => issue.kind === "ambiguous-link"));
  assert.equal(
    issues.some((issue) => issue.kind === "broken-wikilink"),
    false,
  );
});

test("unsafe wikilink paths are rejected by validation", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "Source.md", "# Source\n\n[[../secret]]\n[[/absolute]]\n");

  const { issues } = await buildVaultIndex(vault);
  assert.equal(issues.filter((issue) => issue.kind === "broken-wikilink").length, 2);
  assert.ok(issues.every((issue) => !issue.message.includes("undefined")));
});

test("preview rendering leaves inline-code wikilinks literal", async (t) => {
  const vault = await makeVault(t);
  await createVaultFile(vault, "Notes/note.md", "# Note\n");
  await createVaultFile(vault, "Reference/reference-note.md", "# Reference\n\n[[Notes/note]]\n");

  const { index } = await buildVaultIndex(vault);
  const html = renderMarkdown(
    "Inline `[[Notes/note]]` literal.\n\nVisible [[Notes/note]].\n\n```md\n[[Notes/note]]\n```\n",
    index,
  );
  assert.match(html, /<code>\[\[Notes\/note\]\]<\/code>/);
  assert.match(html, /<a href="#" class="wikilink" data-path="Notes\/note.md"/);
  assert.equal((html.match(/class="wikilink/g) ?? []).length, 1);
});

test("explicit file operations reject symlinks inside vault paths", async (t) => {
  const vault = await makeVault(t);
  const outside = await makeTestTempDir(t, "arepo-outside-");
  await fs.writeFile(path.join(outside, "escape.md"), "# Escape\n", "utf8");
  await fs.writeFile(path.join(outside, "escape.txt"), "Escape\n", "utf8");
  try {
    await fs.symlink(outside, path.join(vault.rootPath, "linked"), "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks unavailable");
      return;
    }
    throw error;
  }

  await assert.rejects(() => readVaultFile(vault, "linked/escape.md"), /Symlinks/);
  await assert.rejects(() => readVaultFile(vault, "linked/escape.txt"), /Symlinks/);
});

test("supported text discovery ignores symlinked plain-text files", async (t) => {
  const vault = await makeVault(t);
  const outside = await makeTestTempDir(t, "arepo-outside-");
  const outsideFile = path.join(outside, "escape.txt");
  await fs.writeFile(outsideFile, "escape\n", "utf8");
  try {
    await fs.symlink(outsideFile, path.join(vault.rootPath, "escape.txt"), "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks unavailable");
      return;
    }
    throw error;
  }

  assert.deepEqual(await listSupportedTextFiles(vault), []);
});
