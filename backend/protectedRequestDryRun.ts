import fs from "node:fs/promises";
import { URL } from "node:url";
import { configPath, loadConfig, resolveAppDataDir } from "./config.js";
import { configuredAllowedOrigins } from "./nodeRuntime.js";
import {
  planProtectedRequestPipeline,
  type ProtectedRequestPipelineResult,
} from "./protectedRequestPipeline.js";
import type {
  AuthConfig,
  ProtectedRequestDryRunSummary,
  RequestPolicyRuntimeStatus,
  VaultConfigFile,
} from "./types.js";
import type { RequestLike } from "./server.js";

export type ProtectedRequestDryRunResult =
  | { status: "disabled"; summary?: undefined; pipelineResult?: undefined }
  | {
      status: "planned";
      summary: ProtectedRequestDryRunSummary;
      pipelineResult: ProtectedRequestPipelineResult;
    }
  | { status: "failed"; summary: ProtectedRequestDryRunSummary; pipelineResult?: undefined };

type DryRunDiagnostics = {
  runCount: number;
  lastResult?: ProtectedRequestDryRunSummary;
};

const diagnostics: DryRunDiagnostics = {
  runCount: 0,
};

export function isProtectedRequestDryRunEnabled(auth: Pick<AuthConfig, "dryRunRequestPolicy">) {
  return auth.dryRunRequestPolicy === true;
}

export function getProtectedRequestDryRunStatus(
  auth: Pick<AuthConfig, "dryRunRequestPolicy">,
): Pick<
  RequestPolicyRuntimeStatus,
  | "dryRunMiddlewareConfigured"
  | "dryRunMiddlewareMounted"
  | "dryRunObservationOnly"
  | "dryRunRunCount"
  | "lastDryRunResult"
> {
  const enabled = isProtectedRequestDryRunEnabled(auth);
  return {
    dryRunMiddlewareConfigured: enabled,
    dryRunMiddlewareMounted: enabled,
    dryRunObservationOnly: true,
    dryRunRunCount: diagnostics.runCount,
    lastDryRunResult: diagnostics.lastResult,
  };
}

export function resetProtectedRequestDryRunDiagnostics(): void {
  diagnostics.runCount = 0;
  diagnostics.lastResult = undefined;
}

export async function runProtectedRequestDryRun(input: {
  request: RequestLike;
  cwd: string;
  url: URL;
}): Promise<ProtectedRequestDryRunResult> {
  const configured = await readDryRunFlag(input.cwd).catch((error) => {
    const summary = failedSummary(input.request, input.url, error);
    recordDryRunSummary(summary);
    return false;
  });
  if (!configured) return { status: "disabled" };

  try {
    const config = await loadConfig(input.cwd);
    if (!isProtectedRequestDryRunEnabled(config.auth)) return { status: "disabled" };
    const result = await planProtectedRequestPipeline({
      appDataDir: resolveAppDataDir(config, input.cwd),
      vaultRoots: config.vaults.map((vault) => vault.rootPath),
      request: {
        method: input.request.method ?? "GET",
        path: `${input.url.pathname}${input.url.search}`,
        headers: plannerHeaders(input.request.headers),
        cookies: parseCookieHeader(headerValue(input.request.headers, "cookie")),
        origin: headerValue(input.request.headers, "origin"),
        referer: headerValue(input.request.headers, "referer"),
      },
      vaultId: vaultIdFromPath(input.url.pathname),
      allowedOrigins: configuredAllowedOrigins(),
      csrfTokenPresent: csrfTokenPresent(input.request.headers),
      audit: { mode: "disabled" },
      now: new Date(),
    });
    const summary = summaryFromPipelineResult(input.request, input.url, result);
    recordDryRunSummary(summary);
    return { status: "planned", summary, pipelineResult: result };
  } catch (error) {
    const summary = failedSummary(input.request, input.url, error);
    recordDryRunSummary(summary);
    return { status: "failed", summary };
  }
}

function recordDryRunSummary(summary: ProtectedRequestDryRunSummary): void {
  diagnostics.runCount += 1;
  diagnostics.lastResult = summary;
}

async function readDryRunFlag(cwd: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath(cwd), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<VaultConfigFile> & {
    auth?: { dryRunRequestPolicy?: unknown };
  };
  return parsed.auth?.dryRunRequestPolicy === true;
}

function summaryFromPipelineResult(
  request: RequestLike,
  url: URL,
  result: ProtectedRequestPipelineResult,
): ProtectedRequestDryRunSummary {
  return {
    timestamp: new Date().toISOString(),
    method: request.method ?? "GET",
    path: url.pathname,
    routePattern: result.decision.routePattern,
    status: result.decision.anonymousReduced
      ? "anonymousReduced"
      : result.decision.wouldAllow
        ? "wouldAllow"
        : "wouldDeny",
    credentialStatus: result.credential.status,
    credentialSource: result.credential.credentialSource,
    reasonCodes: result.reasonCodes.slice(0, 12),
    enforcementActive: false,
    networkExposureSafe: false,
  };
}

function failedSummary(
  request: RequestLike,
  url: URL,
  error: unknown,
): ProtectedRequestDryRunSummary {
  return {
    timestamp: new Date().toISOString(),
    method: request.method ?? "GET",
    path: url.pathname,
    status: "failed",
    reasonCodes: ["dry-run-failed"],
    enforcementActive: false,
    networkExposureSafe: false,
    error: error instanceof Error ? error.message : "Protected request dry-run failed",
  };
}

function plannerHeaders(
  headers: RequestLike["headers"],
): Record<string, string | readonly string[] | undefined> {
  const output: Record<string, string | readonly string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === "cookie") continue;
    if (typeof value === "string" || Array.isArray(value)) {
      output[key] = value;
    }
  }
  return output;
}

function parseCookieHeader(raw: string | undefined): Record<string, string | undefined> {
  if (!raw) return {};
  const cookies: Record<string, string | undefined> = {};
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!key) continue;
    cookies[key] = trimmed.slice(separator + 1).trim();
  }
  return cookies;
}

function csrfTokenPresent(headers: RequestLike["headers"]): boolean {
  return Boolean(
    headerValue(headers, "x-arepo-csrf-token") ??
    headerValue(headers, "x-csrf-token") ??
    headerValue(headers, "csrf-token"),
  );
}

function headerValue(headers: RequestLike["headers"], name: string): string | undefined {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== name) continue;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value[0];
  }
  return undefined;
}

function vaultIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/vaults\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}
