import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  getMachineIndexResult,
  machineIndexPath,
  rebuildMachineIndex,
  refreshMachineIndex,
} from "../dist-backend/backend/indexCache.js";
import { buildIndexFilterResponse } from "../dist-backend/backend/indexFilters.js";
import { buildVaultInspectResponse } from "../dist-backend/backend/indexInspect.js";
import { buildIndexSearchResponse } from "../dist-backend/backend/indexSearch.js";

const PROFILES = {
  small: { files: 100, averageBytes: 12 * 1024, linksPerFile: 4, seed: 1741 },
  medium: { files: 5_000, averageBytes: 12 * 1024, linksPerFile: 6, seed: 1741 },
  datacentre: { files: 50_000, averageBytes: 8 * 1024, linksPerFile: 6, seed: 1741 },
  "file-heavy": { files: 20_000, averageBytes: 1_024, linksPerFile: 2, seed: 1741 },
  "byte-heavy": { files: 500, averageBytes: 128 * 1024, linksPerFile: 6, seed: 1741 },
};

const args = parseArgs(process.argv.slice(2));
const selected = PROFILES[args.profile];
if (!selected)
  fail(`Unknown profile "${args.profile}". Expected ${Object.keys(PROFILES).join(", ")}.`);
const profile = {
  name: args.profile,
  files: positiveInteger(args.files ?? selected.files, "files"),
  averageBytes: positiveInteger(args.averageBytes ?? selected.averageBytes, "average-bytes"),
  linksPerFile: positiveInteger(args.linksPerFile ?? selected.linksPerFile, "links-per-file"),
  seed: positiveInteger(args.seed ?? selected.seed, "seed"),
};
const plannedBytes = profile.files * profile.averageBytes;
const plannedMiB = plannedBytes / 2 ** 20;
console.log(
  `AREPO index benchmark: ${profile.name}; ${profile.files.toLocaleString()} files; approximately ${plannedMiB.toFixed(1)} MiB; seed ${profile.seed}`,
);
if (profile.name === "datacentre") {
  console.log("Datacentre is opt-in and may take several minutes; fixtures remain temporary.");
}

let interrupted = false;
const handleInterrupt = () => {
  interrupted = true;
  console.error("Cancellation requested; cleaning up after the current filesystem operation.");
};
process.once("SIGINT", handleInterrupt);

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-index-bench-"));
const vaultRoot = path.join(fixtureRoot, "vault");
const appDataRoot = path.join(fixtureRoot, "app-data");
const cwd = path.join(fixtureRoot, "cwd");
const previousAppData = process.env.AREPO_APP_DATA_DIR;
process.env.AREPO_APP_DATA_DIR = appDataRoot;

try {
  await assertSafeDiskBudget(fixtureRoot, plannedBytes);
  await Promise.all([fs.mkdir(vaultRoot), fs.mkdir(cwd)]);
  const generationStartedAt = performance.now();
  const corpus = await generateCorpus(vaultRoot, profile, () => interrupted);
  const generationMs = performance.now() - generationStartedAt;
  if (interrupted) throw new Error("Benchmark cancelled.");

  const vault = {
    id: `benchmark-${profile.name}`,
    displayName: `Benchmark ${profile.name}`,
    rootPath: vaultRoot,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: false,
      deleteFiles: false,
    },
  };
  const rows = [];
  const run = async (scenario, operation, iterations = 1) => {
    if (interrupted) throw new Error("Benchmark cancelled.");
    const samples = [];
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      samples.push(await measureOperation(operation));
    }
    const row = summarizeSamples(scenario, samples, corpus);
    rows.push(row);
    printRow(row);
    return row;
  };

  await run("cold-build", (options) => getMachineIndexResult(vault, cwd, options));
  await run(
    "warm-whole-hit",
    (options) => getMachineIndexResult(vault, cwd, options),
    args.warmIterations,
  );

  await mutateSources(vaultRoot, corpus.paths, [0], 1);
  await run("one-file-changed", (options) => getMachineIndexResult(vault, cwd, options));

  await mutateSources(vaultRoot, corpus.paths, selectFraction(profile.files, 0.01), 2);
  await run("one-percent-changed", (options) => getMachineIndexResult(vault, cwd, options));

  await mutateSources(vaultRoot, corpus.paths, [Math.min(11, profile.files - 1)], 5);
  await run("watcher-triggered-refresh", (options) => refreshMachineIndex(vault, cwd, options));

  if (profile.name !== "datacentre" || args.includeTenPercent) {
    await mutateSources(vaultRoot, corpus.paths, selectFraction(profile.files, 0.1), 3);
    await run("ten-percent-changed", (options) => getMachineIndexResult(vault, cwd, options));
  }

  await run("explicit-force-reindex", (options) => rebuildMachineIndex(vault, cwd, options));

  await run("search-filter-inspect-warm", async (options) => {
    const result = await getMachineIndexResult(vault, cwd, options);
    const queryStartedAt = performance.now();
    buildIndexSearchResponse(result.data, "tag-3");
    buildIndexFilterResponse(result.data, "broken-links");
    buildVaultInspectResponse(result.data, corpus.paths[0]);
    return { queryMs: performance.now() - queryStartedAt };
  });

  await run("concurrent-warm-gets", (options) =>
    Promise.all([
      getMachineIndexResult(vault, cwd, options),
      getMachineIndexResult(vault, cwd, options),
    ]),
  );

  await mutateSources(vaultRoot, corpus.paths, [Math.min(7, profile.files - 1)], 4);
  await run("concurrent-get-after-change", (options) =>
    Promise.all([
      getMachineIndexResult(vault, cwd, options),
      getMachineIndexResult(vault, cwd, options),
    ]),
  );

  const cacheFile = await machineIndexPath(vault, cwd);
  const cacheBytes = (await fs.stat(cacheFile)).size;
  const result = {
    schemaVersion: 1,
    environment: environmentInfo(),
    profile,
    corpus: {
      files: corpus.paths.length,
      bytes: corpus.bytes,
      mib: corpus.bytes / 2 ** 20,
      generationMs,
    },
    cache: {
      bytes: cacheBytes,
      mib: cacheBytes / 2 ** 20,
      bytesPerSource: cacheBytes / profile.files,
      bytesPerCanonicalByte: cacheBytes / corpus.bytes,
    },
    rows,
    notes: [
      "AREPO-cache-cold does not imply OS-page-cache-cold.",
      "Repeated scenarios are OS-cache-warm; this harness does not flush the operating-system page cache.",
      "Phase durations from concurrent operations are accumulated observer durations and may overlap in wall time.",
      "Memory peaks are sampled process-wide and are approximate.",
    ],
  };
  console.log(
    `Cache: ${(cacheBytes / 2 ** 20).toFixed(2)} MiB (${(cacheBytes / profile.files).toFixed(0)} bytes/source; ${(cacheBytes / corpus.bytes).toFixed(3)}x corpus bytes)`,
  );
  if (args.json) {
    await fs.writeFile(path.resolve(args.json), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`Machine-readable result: ${path.resolve(args.json)}`);
  }
} finally {
  process.removeListener("SIGINT", handleInterrupt);
  if (previousAppData === undefined) delete process.env.AREPO_APP_DATA_DIR;
  else process.env.AREPO_APP_DATA_DIR = previousAppData;
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}

function parseArgs(argv) {
  const out = {
    profile: "small",
    warmIterations: 3,
    includeTenPercent: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--include-ten-percent") {
      out.includeTenPercent = true;
      continue;
    }
    const [name, inline] = arg.split("=", 2);
    const key = {
      "--profile": "profile",
      "--files": "files",
      "--average-bytes": "averageBytes",
      "--links-per-file": "linksPerFile",
      "--seed": "seed",
      "--warm-iterations": "warmIterations",
      "--read-concurrency": "readConcurrency",
      "--json": "json",
    }[name];
    if (!key) fail(`Unknown argument ${arg}.`);
    const value = inline ?? argv[++index];
    if (value === undefined) fail(`${name} requires a value.`);
    out[key] = key === "profile" || key === "json" ? value : Number(value);
  }
  out.warmIterations = positiveInteger(out.warmIterations, "warm-iterations");
  return out;
}

async function assertSafeDiskBudget(target, corpusBytes) {
  if (typeof fs.statfs !== "function") return;
  const stat = await fs.statfs(target);
  const available = Number(stat.bavail) * Number(stat.bsize);
  const estimatedWorkingSet = corpusBytes * 3;
  const reserved = Math.max(2 * 2 ** 30, available * 0.75);
  if (estimatedWorkingSet > available - reserved) {
    fail(
      `Refusing benchmark: estimated ${formatMiB(estimatedWorkingSet)} working set leaves an unsafe margin from ${formatMiB(available)} available. Reduce --files or --average-bytes.`,
    );
  }
}

async function generateCorpus(root, profile, cancelled) {
  const paths = Array.from({ length: profile.files }, (_, index) => sourcePath(index));
  let bytes = 0;
  await mapConcurrent(paths, 32, async (relativePath, index) => {
    if (cancelled()) throw new Error("Benchmark cancelled.");
    const content = sourceContent(index, profile);
    bytes += Buffer.byteLength(content, "utf8");
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  });
  return { paths, bytes };
}

function sourcePath(index) {
  const depth = index % 5;
  const parts = ["notes"];
  if (depth >= 1) parts.push(`region-${String(index % 17).padStart(2, "0")}`);
  if (depth >= 2) parts.push(`rack-${String(Math.floor(index / 17) % 31).padStart(2, "0")}`);
  if (depth >= 3) parts.push(`group-${String(Math.floor(index / 527) % 19).padStart(2, "0")}`);
  if (depth >= 4) parts.push(`tier-${index % 7}`);
  parts.push(`note-${String(index).padStart(6, "0")}.md`);
  return parts.join("/");
}

function sourceContent(index, profile) {
  const random = mulberry32((profile.seed + index * 0x9e3779b1) >>> 0);
  const sizeFactor = random() < 0.7 ? 0.7 : random() < 0.833333 ? 1.2 : 4;
  const targetBytes = Math.max(512, Math.floor(profile.averageBytes * sizeFactor));
  const headings = 2 + (index % 4);
  const duplicateId = index % 251 === 0 ? `duplicate-${index % 5}` : `source-${index}`;
  const lines = [
    "---",
    `id: ${duplicateId}`,
    `title: Synthetic Source ${index}`,
    "tags:",
    `  - tag-${index % 13}`,
    `  - zone-${Math.floor(index / 13) % 11}`,
    "---",
    `# Synthetic Source ${index} {#source-${index}}`,
    "",
    "variant-0",
  ];
  for (let heading = 0; heading < headings; heading += 1) {
    lines.push("", `${"#".repeat(2 + (heading % 3))} Section ${heading} {#section-${heading}}`);
  }
  for (let link = 0; link < profile.linksPerFile; link += 1) {
    const target = (index * 37 + link * 101 + 1) % profile.files;
    if (link === profile.linksPerFile - 1 && index % 20 === 0) {
      lines.push(`[[missing-${index}|Broken ${index}]]`);
    } else if (link % 2 === 0) {
      lines.push(
        `[[note-${String(target).padStart(6, "0")}#section-${link % headings}|Target ${target}]]`,
      );
    } else {
      lines.push(`[[source-${target}]]`);
    }
  }
  let content = `${lines.join("\n")}\n`;
  let paragraph = 0;
  while (Buffer.byteLength(content, "utf8") < targetBytes) {
    content += `Synthetic deterministic paragraph ${index}-${paragraph} ${randomWords(random, 24)}\n`;
    paragraph += 1;
  }
  return content;
}

function randomWords(random, count) {
  const words = [
    "archive",
    "bounded",
    "canonical",
    "derived",
    "evidence",
    "graph",
    "hash",
    "index",
    "link",
    "markdown",
    "note",
    "source",
    "vault",
    "watcher",
  ];
  return Array.from({ length: count }, () => words[Math.floor(random() * words.length)]).join(" ");
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

async function mutateSources(root, paths, indexes, variant) {
  await mapConcurrent(indexes, 16, async (index) => {
    const file = path.join(root, paths[index]);
    const stat = await fs.stat(file);
    const content = await fs.readFile(file, "utf8");
    const updated = content.replace(/variant-\d/, `variant-${variant}`);
    if (updated.length !== content.length) throw new Error("Same-size mutation invariant failed.");
    await fs.writeFile(file, updated, "utf8");
    await fs.utimes(file, stat.atime, stat.mtime);
  });
}

function selectFraction(fileCount, fraction) {
  const count = Math.max(1, Math.floor(fileCount * fraction));
  return Array.from({ length: count }, (_, index) => Math.floor((index * fileCount) / count));
}

async function measureOperation(operation) {
  const counts = {
    supportedFiles: 0,
    bodyReads: 0,
    bytesRead: 0,
    hashes: 0,
    sourceDerivations: 0,
    sourceDerivativesReused: 0,
    globalAssemblies: 0,
    cacheHits: 0,
    publications: 0,
    cacheBytesRead: 0,
    cacheBytesWritten: 0,
    fsConcurrencyHighWater: 0,
    duplicateBodyReads: 0,
  };
  const phases = {
    discoveryMs: 0,
    captureMs: 0,
    hashMs: 0,
    derivationMs: 0,
    assemblyMs: 0,
    cacheReadMs: 0,
    serializationMs: 0,
    publicationMs: 0,
    queryMs: 0,
  };
  let activeReads = 0;
  const readPaths = new Set();
  const instrumentation = {
    onMarkdownBodyRead: (sourcePath) => {
      counts.bodyReads += 1;
      if (readPaths.has(sourcePath)) counts.duplicateBodyReads += 1;
      readPaths.add(sourcePath);
      activeReads += 1;
      counts.fsConcurrencyHighWater = Math.max(counts.fsConcurrencyHighWater, activeReads);
    },
    onMarkdownBodyReadComplete: (_sourcePath, bytes) => {
      counts.bytesRead += bytes;
    },
    onMarkdownBodyReadSettled: () => {
      activeReads -= 1;
    },
    onHashCalculated: (_sourcePath, durationMs) => {
      counts.hashes += 1;
      phases.hashMs += durationMs;
    },
    onDiscoveryComplete: (fileCount, durationMs) => {
      counts.supportedFiles = Math.max(counts.supportedFiles, fileCount);
      phases.discoveryMs += durationMs;
    },
    onSourceCaptureComplete: (durationMs) => {
      phases.captureMs += durationMs;
    },
    onSourceDerived: (_sourcePath, durationMs) => {
      counts.sourceDerivations += 1;
      phases.derivationMs += durationMs;
    },
    onSourceDerivativeReused: () => {
      counts.sourceDerivativesReused += 1;
    },
    onGlobalAssembly: (durationMs) => {
      counts.globalAssemblies += 1;
      phases.assemblyMs += durationMs;
    },
    onCacheRead: (bytes, durationMs) => {
      counts.cacheBytesRead += bytes;
      phases.cacheReadMs += durationMs;
    },
    onCacheHit: () => {
      counts.cacheHits += 1;
    },
    onCacheSerialization: (_bytes, durationMs) => {
      phases.serializationMs += durationMs;
    },
    onCachePublication: (bytes, durationMs) => {
      counts.cacheBytesWritten += bytes;
      phases.publicationMs += durationMs;
    },
    onPublication: () => {
      counts.publications += 1;
    },
  };
  const before = process.memoryUsage();
  let peak = before;
  const sampleMemory = () => {
    const current = process.memoryUsage();
    peak = {
      rss: Math.max(peak.rss, current.rss),
      heapTotal: Math.max(peak.heapTotal, current.heapTotal),
      heapUsed: Math.max(peak.heapUsed, current.heapUsed),
      external: Math.max(peak.external, current.external),
      arrayBuffers: Math.max(peak.arrayBuffers, current.arrayBuffers),
    };
  };
  const sampler = setInterval(sampleMemory, 10);
  const startedAt = performance.now();
  try {
    const operationResult = await operation({
      instrumentation,
      maxConcurrentMarkdownReads: args.readConcurrency,
    });
    if (operationResult && typeof operationResult.queryMs === "number") {
      phases.queryMs = operationResult.queryMs;
    }
  } finally {
    clearInterval(sampler);
  }
  sampleMemory();
  const after = process.memoryUsage();
  return {
    totalMs: performance.now() - startedAt,
    counts,
    phases,
    memory: {
      before: memoryMiB(before),
      peak: memoryMiB(peak),
      after: memoryMiB(after),
      processMaxRssMiB: process.resourceUsage().maxRSS / 1024,
    },
  };
}

function summarizeSamples(scenario, samples, corpus) {
  const sorted = [...samples].sort((a, b) => a.totalMs - b.totalMs);
  const median = sorted[Math.floor(sorted.length / 2)];
  return {
    scenario,
    iterations: samples.length,
    totalMs: median.totalMs,
    minMs: sorted[0].totalMs,
    maxMs: sorted[sorted.length - 1].totalMs,
    msPerThousandFiles: median.totalMs / (corpus.paths.length / 1000),
    canonicalReadMiBPerSecond:
      median.counts.bytesRead > 0
        ? median.counts.bytesRead / 2 ** 20 / (median.phases.captureMs / 1000)
        : 0,
    ...median,
  };
}

function printRow(row) {
  const c = row.counts;
  const p = row.phases;
  console.log(
    `${row.scenario.padEnd(29)} ${row.totalMs.toFixed(1).padStart(9)} ms | reads ${String(c.bodyReads).padStart(6)} (${formatMiB(c.bytesRead)}) | parses ${String(c.sourceDerivations).padStart(6)} | reused ${String(c.sourceDerivativesReused).padStart(6)} | assembly ${p.assemblyMs.toFixed(1).padStart(7)} ms | cache I/O ${(p.cacheReadMs + p.serializationMs + p.publicationMs).toFixed(1).padStart(7)} ms | peak RSS ${row.memory.peak.rss.toFixed(1)} MiB | fs high-water ${c.fsConcurrencyHighWater}`,
  );
}

async function mapConcurrent(items, limit, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await work(items[index], index);
      }
    }),
  );
}

function memoryMiB(value) {
  return Object.fromEntries(Object.entries(value).map(([key, bytes]) => [key, bytes / 2 ** 20]));
}

function environmentInfo() {
  return {
    node: process.version,
    platform: process.platform,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCores: os.cpus().length,
    ramGiB: os.totalmem() / 2 ** 30,
  };
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} must be a positive integer.`);
  return value;
}

function formatMiB(bytes) {
  return `${(bytes / 2 ** 20).toFixed(1)} MiB`;
}

function fail(message) {
  throw new Error(message);
}
