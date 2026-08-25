import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-observation-"));
let root = path.join(fixture, "vault");
const outside = path.join(fixture, "outside");
let source = path.join(root, "note.md");
const initial = "alpha-0000\n";
const results = [];

try {
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(source, initial);

  await run("normal-overwrite", async () => fs.writeFile(source, "bravo-0000\n"));
  await run("same-size-restored-mtime", async (before) => {
    await fs.writeFile(source, "charl-0000\n");
    await fs.utimes(source, before.atimeMs / 1000, before.mtimeMs / 1000);
  });
  await run("truncate-and-rewrite", async () => {
    await fs.truncate(source, 0);
    await fs.writeFile(source, "delta-0000\n");
  });
  await run("append", async () => fs.appendFile(source, "appended\n"));
  await run("atomic-temp-replacement", async () => {
    const temporary = path.join(root, ".note.md.tmp");
    await fs.writeFile(temporary, "echo--0000\n");
    await fs.rename(temporary, source);
  });
  await run("delete-and-recreate", async () => {
    await fs.unlink(source);
    await fs.writeFile(source, "foxtt-0000\n");
  });
  await run("rename-away-and-back", async () => {
    const away = path.join(root, "away.md");
    await fs.rename(source, away);
    await fs.rename(away, source);
  });
  await run("chmod-unreadable", async () => {
    await fs.chmod(source, 0);
    return async () => fs.chmod(source, 0o600);
  });
  await run("hard-link-write-outside-root", async () => {
    const alias = path.join(outside, "alias.md");
    await fs.link(source, alias);
    await fs.writeFile(alias, "golf--0000\n");
    return async () => fs.unlink(alias);
  });
  await run("memory-mapped-write", async () => {
    await execFileAsync("python3", [
      "-c",
      [
        "import mmap,sys",
        "with open(sys.argv[1], 'r+b') as f:",
        " m=mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_WRITE)",
        " m[0:5]=b'hotel'",
        " m.flush()",
        " m.close()",
      ].join("\n"),
      source,
    ]);
  });
  await run("rapid-burst-200-writes", async () => {
    for (let index = 0; index < 200; index += 1) {
      await fs.writeFile(source, `burst-${String(index).padStart(4, "0")}\n`);
    }
  });
  await run("nested-directory-create-delete", async () => {
    const nested = path.join(root, "new", "deep");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "nested.md"), "nested\n");
    await fs.rm(path.join(root, "new"), { recursive: true });
  });
  await run("directory-containing-source-rename", async () => {
    const nested = path.join(root, "nested");
    await fs.mkdir(nested);
    await fs.rename(source, path.join(nested, "note.md"));
    await fs.rename(nested, path.join(root, "renamed"));
    await fs.rename(path.join(root, "renamed", "note.md"), source);
    await fs.rmdir(path.join(root, "renamed"));
  });

  const stoppedBefore = await observe(source);
  await fs.writeFile(source, "india-0000\n");
  const stoppedAfter = await observe(source);
  const restartedEvents = [];
  const restarted = fsSync.watch(root, (eventType, filename) => {
    restartedEvents.push({ eventType, filename: filename?.toString() ?? null });
  });
  await pause(150);
  restarted.close();
  results.push({
    operation: "observer-stop-change-restart",
    rootEvents: restartedEvents,
    fileEvents: [],
    before: stoppedBefore,
    after: stoppedAfter,
    hashChanged: stoppedBefore.hash !== stoppedAfter.hash,
    identityChanged: identity(stoppedBefore) !== identity(stoppedAfter),
    gapDetectableByFsWatch: false,
    note: "A newly created fs.watch observer has no history or cursor.",
  });

  await run("root-rename", async () => {
    const moved = path.join(fixture, "vault-moved");
    await fs.rename(root, moved);
    root = moved;
    source = path.join(root, "note.md");
  });

  console.log(
    JSON.stringify(
      {
        environment: {
          platform: process.platform,
          node: process.version,
          kernel: os.release(),
          filesystem: (await fs.statfs(root)).type,
        },
        warning:
          "This probe can falsify assumptions on one host; it does not establish portable API guarantees.",
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await fs.chmod(source, 0o600).catch(() => undefined);
  await fs.rm(fixture, { recursive: true, force: true });
}

async function run(operation, mutate) {
  await fs.writeFile(source, initial);
  await pause(40);
  const rootEvents = [];
  const fileEvents = [];
  const watcherErrors = [];
  const rootWatcher = fsSync.watch(root, (eventType, filename) => {
    rootEvents.push({ eventType, filename: filename?.toString() ?? null });
  });
  const fileWatcher = fsSync.watch(source, (eventType, filename) => {
    fileEvents.push({ eventType, filename: filename?.toString() ?? null });
  });
  rootWatcher.on("error", (error) => watcherErrors.push(`root:${error.code ?? error.name}`));
  fileWatcher.on("error", (error) => watcherErrors.push(`file:${error.code ?? error.name}`));

  const before = await observe(source);
  let cleanup;
  try {
    cleanup = await mutate(before);
    await pause(150);
    const after = await observe(source);
    results.push({
      operation,
      rootEvents,
      fileEvents,
      watcherErrors,
      before,
      after,
      hashChanged: before.hash !== after.hash,
      identityChanged: identity(before) !== identity(after),
      metadataChanged: metadata(before) !== metadata(after),
      gapDetectableByFsWatch: false,
    });
  } finally {
    rootWatcher.close();
    fileWatcher.close();
    await cleanup?.();
  }
}

async function observe(file) {
  try {
    const stat = await fs.lstat(file, { bigint: true });
    let hash;
    try {
      hash = crypto
        .createHash("sha256")
        .update(await fs.readFile(file))
        .digest("hex");
    } catch (error) {
      hash = `ERROR:${error.code ?? error.name}`;
    }
    return {
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      nlink: stat.nlink.toString(),
      mode: Number(stat.mode & 0o777n).toString(8),
      size: stat.size.toString(),
      mtimeNs: stat.mtimeNs.toString(),
      ctimeNs: stat.ctimeNs.toString(),
      atimeMs: Number(stat.atimeMs),
      mtimeMs: Number(stat.mtimeMs),
      hash,
    };
  } catch (error) {
    return { error: error.code ?? error.name, hash: `ERROR:${error.code ?? error.name}` };
  }
}

function identity(observation) {
  return `${observation.dev}:${observation.ino}`;
}

function metadata(observation) {
  return [
    observation.dev,
    observation.ino,
    observation.nlink,
    observation.mode,
    observation.size,
    observation.mtimeNs,
    observation.ctimeNs,
  ].join(":");
}

function pause(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
