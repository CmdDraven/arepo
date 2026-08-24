import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { browseServerDirectories } from "./directoryBrowser.js";
import { apiErrorResponse, PublicApiError } from "./publicApiError.js";
import { makeTestTempDir } from "./testTemp.js";

test("default directory browsing starts at the canonical home directory", async () => {
  const response = await browseServerDirectories(null);
  assert.equal(response.currentPath, await fs.realpath(os.homedir()));
  assert.ok(response.directories.every((entry) => path.isAbsolute(entry.path)));
});

test("explicit browsing returns sorted child directories without files or symlinks", async (t) => {
  const root = await makeTestTempDir(t, "arepo-directory-browser-");
  await fs.mkdir(path.join(root, "zeta"));
  await fs.mkdir(path.join(root, "alpha"));
  await fs.writeFile(path.join(root, "visible-file.txt"), "not a directory\n", "utf8");
  try {
    await fs.symlink(path.join(root, "alpha"), path.join(root, "linked-directory"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  }

  const response = await browseServerDirectories(root);
  assert.equal(response.currentPath, await fs.realpath(root));
  assert.equal(response.parentPath, path.dirname(await fs.realpath(root)));
  assert.deepEqual(response.directories, [
    { name: "alpha", path: path.join(await fs.realpath(root), "alpha") },
    { name: "zeta", path: path.join(await fs.realpath(root), "zeta") },
  ]);
  assert.equal(JSON.stringify(response).includes("visible-file.txt"), false);
  assert.equal(JSON.stringify(response).includes("linked-directory"), false);
});

test("an explicitly supplied terminal directory symlink is rejected without being followed", async (t) => {
  const root = await makeTestTempDir(t, "arepo-directory-browser-");
  const target = path.join(root, "target-directory");
  const link = path.join(root, "requested-directory-link");
  await fs.mkdir(target);
  try {
    await fs.symlink(target, link, "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks unavailable");
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => browseServerDirectories(link),
    (error: unknown) => {
      assert.ok(error instanceof PublicApiError);
      assert.deepEqual(apiErrorResponse(error), {
        status: 400,
        body: {
          ok: false,
          error: "Directory symlinks cannot be browsed.",
          code: "directory-symlink-not-allowed",
        },
      });
      const serialized = JSON.stringify(apiErrorResponse(error));
      assert.equal(serialized.includes(target), false);
      assert.equal(serialized.includes(link), false);
      return true;
    },
  );
});

test("an intermediate directory symlink component is rejected without being followed", async (t) => {
  const sourceRoot = await makeTestTempDir(t, "arepo-directory-browser-source-");
  const targetRoot = await makeTestTempDir(t, "arepo-directory-browser-target-");
  const targetDirectory = path.join(targetRoot, "nested-directory");
  const link = path.join(sourceRoot, "intermediate-link");
  await fs.mkdir(targetDirectory);
  try {
    await fs.symlink(targetRoot, link, "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks unavailable");
      return;
    }
    throw error;
  }

  const requestedPath = path.join(link, "nested-directory");
  await assert.rejects(
    () => browseServerDirectories(requestedPath),
    (error: unknown) => {
      assert.ok(error instanceof PublicApiError);
      assert.deepEqual(apiErrorResponse(error), {
        status: 400,
        body: {
          ok: false,
          error: "Directory symlinks cannot be browsed.",
          code: "directory-symlink-not-allowed",
        },
      });
      const serialized = JSON.stringify(apiErrorResponse(error));
      for (const hidden of [sourceRoot, targetRoot, link, targetDirectory, requestedPath]) {
        assert.equal(serialized.includes(hidden), false, hidden);
      }
      return true;
    },
  );
});

test("ordinary nested directories remain browsable", async (t) => {
  const root = await makeTestTempDir(t, "arepo-directory-browser-");
  const nested = path.join(root, "ordinary", "nested");
  await fs.mkdir(nested, { recursive: true });

  const response = await browseServerDirectories(nested);
  assert.equal(response.currentPath, await fs.realpath(nested));
  assert.equal(response.parentPath, await fs.realpath(path.dirname(nested)));
  assert.deepEqual(response.directories, []);
});

test("filesystem root has no parent navigation target", async () => {
  const response = await browseServerDirectories(path.parse(process.cwd()).root);
  assert.equal(response.parentPath, null);
});

test("relative directory input is a bounded public validation error", async () => {
  await assert.rejects(
    () => browseServerDirectories("relative/folder"),
    (error: unknown) => {
      assert.ok(error instanceof PublicApiError);
      assert.deepEqual(apiErrorResponse(error), {
        status: 400,
        body: {
          ok: false,
          error: "Directory path must be absolute.",
          code: "invalid-directory-path",
        },
      });
      return true;
    },
  );
});

test("unreadable directory failures are sanitized without paths or filesystem details", async (t) => {
  const root = await makeTestTempDir(t, "arepo-directory-browser-secret-");
  t.after(async () => {
    await fs.chmod(root, 0o700).catch(() => undefined);
  });
  await fs.chmod(root, 0o000);

  let caught: unknown;
  try {
    await browseServerDirectories(root);
  } catch (error) {
    caught = error;
  }
  if (!caught) {
    t.skip("current process can enumerate mode-000 directories");
    return;
  }

  const response = apiErrorResponse(caught);
  assert.deepEqual(response, {
    status: 500,
    body: { ok: false, error: "Internal server error", code: "internal-error" },
  });
  const serialized = JSON.stringify(response);
  for (const hidden of [root, "EACCES", "EPERM", "scandir", "permission denied", "stack"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});
