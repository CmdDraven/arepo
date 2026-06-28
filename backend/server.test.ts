import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { routeRequest, type RequestLike } from "./server.js";
import { machineIndexPath } from "./indexCache.js";
import { buildGraph } from "../src/lib/vault/graph.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";

function request(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): RequestLike {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      yield* payload;
    },
  };
}

async function writeConfig(cwd: string, appDataDir: string): Promise<void> {
  await fs.mkdir(path.join(cwd, ".mdatlas"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".mdatlas", "config.json"),
    JSON.stringify({
      node: {
        nodeId: "local",
        displayName: "Local Node",
        mode: "local",
        apiVersion: 1,
      },
      appDataDir,
      vaults: [],
    }),
    "utf8",
  );
}

function relativeIsInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function statusBody(response: Awaited<ReturnType<typeof routeRequest>>) {
  return response.body as {
    indexStatus: string;
    changedExternally: boolean;
    changedPaths: string[];
    addedPaths: string[];
    deletedPaths: string[];
    file?: {
      path: string;
      exists: boolean;
      hash?: string;
      changedExternally: boolean;
      deletedExternally: boolean;
    };
  };
}

test("health endpoint returns local node info", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-server-"));
  const response = await routeRequest(request("GET", "/api/health"), cwd);
  assert.equal(response.status, 200);
  assert.equal((response.body as { ok: boolean }).ok, true);
});

test("vault registration and file APIs stay inside configured root", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-root-"));

  const created = await routeRequest(
    request("POST", "/api/vaults", { rootPath, displayName: "Docs" }),
    cwd,
  );
  assert.equal(created.status, 201);
  const vaultId = (created.body as { data: { vault: { id: string } } }).data.vault.id;

  const file = await routeRequest(
    request("POST", `/api/vaults/${vaultId}/file`, { path: "notes.md" }),
    cwd,
  );
  assert.equal(file.status, 201);

  const traversal = await routeRequest(
    request("GET", `/api/vaults/${vaultId}/file?path=../secret.md`),
    cwd,
  );
  assert.equal(traversal.status, 400);
});

test("vault indexing works without a user-authored index.md", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-root-"));
  await fs.mkdir(path.join(rootPath, "Projects"));
  await fs.writeFile(
    path.join(rootPath, "Home.md"),
    "# Home\n\nSee [[Alpha]] and [[Missing Note]].\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootPath, "Projects", "Alpha.md"),
    "# Alpha\n\nBack to [[Home]].\n",
    "utf8",
  );

  const created = await routeRequest(
    request("POST", "/api/vaults", { rootPath, displayName: "Acceptance Vault" }),
    cwd,
  );
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const cacheFile = await machineIndexPath(vault, cwd);
  await fs.access(cacheFile);
  assert.equal(relativeIsInside(appDataDir, cacheFile), true);
  assert.equal(relativeIsInside(rootPath, cacheFile), false);

  const response = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(response.status, 200);
  const { index, issues } = response.body as VaultIndexResponse;
  assert.deepEqual(Object.keys(index.notes).sort(), ["Home.md", "Projects/Alpha.md"]);
  assert.equal(index.notes["index.md"], undefined);
  assert.equal(index.backlinks["Projects/Alpha.md"]?.[0]?.fromPath, "Home.md");
  assert.equal(index.brokenLinks[0]?.target, "Missing Note");

  const graph = buildGraph(index, issues);
  assert.ok(graph.nodes.some((node) => node.id === "Home.md"));
  assert.ok(
    graph.edges.some((edge) => edge.source === "Home.md" && edge.target === "Projects/Alpha.md"),
  );
  assert.ok(graph.nodes.some((node) => node.id === "missing:Missing Note"));
});

test("user-authored index.md is indexed as a normal note when present", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-root-"));
  await fs.writeFile(path.join(rootPath, "Home.md"), "# Home\n\n[[index]]\n", "utf8");
  await fs.writeFile(path.join(rootPath, "index.md"), "# Optional Homepage\n\n[[Home]]\n", "utf8");

  const created = await routeRequest(
    request("POST", "/api/vaults", { rootPath, displayName: "Docs" }),
    cwd,
  );
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const response = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(response.status, 200);
  const { index } = response.body as VaultIndexResponse;
  assert.equal(index.notes["index.md"]?.title, "Optional Homepage");
  assert.equal(index.backlinks["index.md"]?.[0]?.fromPath, "Home.md");
  assert.equal(index.backlinks["Home.md"]?.[0]?.fromPath, "index.md");
});

test("external file change is surfaced through vault status", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-root-"));
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n\nExternal edit.\n", "utf8");
  const status = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/status?path=note.md`),
    cwd,
  );
  assert.equal(status.status, 200);
  const body = statusBody(status);
  assert.equal(body.changedExternally, true);
  assert.ok(["stale", "rebuilding", "fresh"].includes(body.indexStatus));
  assert.equal(body.file?.exists, true);
  assert.equal(body.file?.changedExternally, true);
  assert.ok(body.changedPaths.includes("note.md"));
});

test("external additions and deletions are reflected in status and rebuilt index", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-root-"));
  await fs.writeFile(path.join(rootPath, "a.md"), "# A\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  await fs.writeFile(path.join(rootPath, "b.md"), "# B\n", "utf8");
  const added = await routeRequest(request("GET", `/api/vaults/${vault.id}/status`), cwd);
  assert.equal(added.status, 200);
  assert.ok(statusBody(added).addedPaths.includes("b.md"));

  await fs.unlink(path.join(rootPath, "a.md"));
  const deleted = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/status?path=a.md`),
    cwd,
  );
  assert.equal(deleted.status, 200);
  assert.equal(statusBody(deleted).file?.exists, false);
  assert.ok(statusBody(deleted).deletedPaths.includes("a.md"));

  const indexResponse = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(indexResponse.status, 200);
  const { index } = indexResponse.body as VaultIndexResponse;
  assert.equal(index.notes["a.md"], undefined);
  assert.ok(index.notes["b.md"]);
});

test("watch/index status ignores symlink escapes", async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-root-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-outside-"));
  await fs.writeFile(path.join(outside, "escape.md"), "# Escape\n", "utf8");
  try {
    await fs.symlink(outside, path.join(rootPath, "linked"), "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks unavailable");
      return;
    }
    throw error;
  }

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const indexResponse = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(indexResponse.status, 200);
  const { index } = indexResponse.body as VaultIndexResponse;
  assert.equal(index.notes["linked/escape.md"], undefined);

  const files = await routeRequest(request("GET", `/api/vaults/${vault.id}/files`), cwd);
  assert.equal(files.status, 200);
  assert.deepEqual((files.body as { files: { path: string }[] }).files, []);
});

test("cors allows default local dev origins, env extras, and rejects arbitrary origins", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-server-"));
  const localhost = await routeRequest(
    request("GET", "/api/health", undefined, { origin: "http://localhost:8733" }),
    cwd,
  );
  assert.equal(localhost.status, 200);
  assert.equal(localhost.headers?.["access-control-allow-origin"], "http://localhost:8733");

  const loopback = await routeRequest(
    request("GET", "/api/health", undefined, { origin: "http://127.0.0.1:8733" }),
    cwd,
  );
  assert.equal(loopback.status, 200);
  assert.equal(loopback.headers?.["access-control-allow-origin"], "http://127.0.0.1:8733");

  const originalAllowedOrigins = process.env.MDATLAS_ALLOWED_ORIGINS;
  process.env.MDATLAS_ALLOWED_ORIGINS = "http://localhost:9001";
  try {
    const extra = await routeRequest(
      request("GET", "/api/health", undefined, { origin: "http://localhost:9001" }),
      cwd,
    );
    assert.equal(extra.status, 200);
    assert.equal(extra.headers?.["access-control-allow-origin"], "http://localhost:9001");
  } finally {
    if (originalAllowedOrigins === undefined) {
      delete process.env.MDATLAS_ALLOWED_ORIGINS;
    } else {
      process.env.MDATLAS_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  }

  const rejected = await routeRequest(
    request("GET", "/api/health", undefined, { origin: "https://example.com" }),
    cwd,
  );
  assert.equal(rejected.status, 403);
  assert.equal((rejected.body as { ok: boolean }).ok, false);
});
