import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import {
  atomicWriteFile,
  buildVaultIndex,
  createVaultFile,
  deleteVaultFile,
  listSupportedTextFiles,
  readVaultFile,
  renameVaultPath,
  writeVaultFile,
} from "./vaultFs.js";
import { renderMarkdown } from "../src/lib/vault/render.js";
import { buildGraph } from "../src/lib/vault/graph.js";
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
