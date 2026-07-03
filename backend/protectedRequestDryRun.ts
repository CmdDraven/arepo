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
  ProtectedRequestDryRunCanaryStatus,
  ProtectedRequestDryRunAuditStatus,
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
  auditAppendCount: number;
  lastResult?: ProtectedRequestDryRunSummary;
  lastAuditStatus?: ProtectedRequestDryRunAuditStatus;
};

const diagnostics: DryRunDiagnostics = {
  runCount: 0,
  auditAppendCount: 0,
};

export function isProtectedRequestDryRunEnabled(auth: Pick<AuthConfig, "dryRunRequestPolicy">) {
  return auth.dryRunRequestPolicy === true;
}

export function isProtectedRequestDryRunAuditEnabled(
  auth: Pick<AuthConfig, "dryRunAudit" | "dryRunRequestPolicy">,
) {
  return isProtectedRequestDryRunEnabled(auth) && auth.dryRunAudit === true;
}

export function getProtectedRequestDryRunStatus(
  auth: Pick<AuthConfig, "dryRunAudit" | "dryRunRequestPolicy">,
): Pick<
  RequestPolicyRuntimeStatus,
  | "dryRunMiddlewareConfigured"
  | "dryRunMiddlewareMounted"
  | "dryRunObservationOnly"
  | "dryRunRunCount"
  | "dryRunAuditConfigured"
  | "dryRunAuditAppendCount"
  | "lastDryRunAuditStatus"
  | "lastDryRunResult"
> {
  const enabled = isProtectedRequestDryRunEnabled(auth);
  const auditConfigured = auth.dryRunAudit === true;
  return {
    dryRunMiddlewareConfigured: enabled,
    dryRunMiddlewareMounted: enabled,
    dryRunObservationOnly: true,
    dryRunRunCount: diagnostics.runCount,
    dryRunAuditConfigured: auditConfigured,
    dryRunAuditAppendCount: diagnostics.auditAppendCount,
    lastDryRunAuditStatus: diagnostics.lastAuditStatus,
    lastDryRunResult: diagnostics.lastResult,
  };
}

export function getProtectedRequestDryRunCanaryStatus(
  auth: Pick<AuthConfig, "dryRunAudit" | "dryRunRequestPolicy">,
): ProtectedRequestDryRunCanaryStatus {
  const status = getProtectedRequestDryRunStatus(auth);
  return {
    ok: true,
    diagnosticOnly: true,
    dryRunConfigured: status.dryRunMiddlewareConfigured,
    dryRunMounted: status.dryRunMiddlewareMounted,
    dryRunObservationOnly: true,
    dryRunAuditConfigured: status.dryRunAuditConfigured,
    dryRunRunCount: status.dryRunRunCount,
    dryRunAuditAppendCount: status.dryRunAuditAppendCount,
    lastDryRunStatus: status.lastDryRunResult
      ? {
          timestamp: status.lastDryRunResult.timestamp,
          method: status.lastDryRunResult.method,
          status: status.lastDryRunResult.status,
          reasonCodes: status.lastDryRunResult.reasonCodes,
        }
      : undefined,
    lastAuditStatus: status.lastDryRunAuditStatus
      ? {
          mode: status.lastDryRunAuditStatus.mode,
          status: status.lastDryRunAuditStatus.status,
          reasonCode: status.lastDryRunAuditStatus.reasonCode,
        }
      : undefined,
    enforcementActive: false,
    protectedModeOperational: false,
    networkExposureSafe: false,
  };
}

export function resetProtectedRequestDryRunDiagnostics(): void {
  diagnostics.runCount = 0;
  diagnostics.auditAppendCount = 0;
  diagnostics.lastResult = undefined;
  diagnostics.lastAuditStatus = undefined;
}

export async function runProtectedRequestDryRun(input: {
  request: RequestLike;
  cwd: string;
  url: URL;
}): Promise<ProtectedRequestDryRunResult> {
  const configured = await readDryRunFlag(input.cwd).catch((error) => {
    const summary = failedSummary(input.request, input.url, error);
    recordDryRunSummary(summary);
    return {};
  });
  if (!isProtectedRequestDryRunEnabled(configured)) return { status: "disabled" };

  try {
    const config = await loadConfig(input.cwd);
    if (!isProtectedRequestDryRunEnabled(config.auth)) return { status: "disabled" };
    const auditMode = isProtectedRequestDryRunAuditEnabled(config.auth) ? "append" : "disabled";
    const result = await planProtectedRequestPipeline({
      appDataDir: resolveAppDataDir(config, input.cwd),
      vaultRoots: config.vaults.map((vault) => vault.rootPath),
      request: {
        method: input.request.method ?? "GET",
        path: input.url.pathname,
        headers: plannerHeaders(input.request.headers),
        cookies: parseCookieHeader(headerValue(input.request.headers, "cookie")),
        origin: headerValue(input.request.headers, "origin"),
        referer: headerValue(input.request.headers, "referer"),
      },
      vaultId: vaultIdFromPath(input.url.pathname),
      allowedOrigins: configuredAllowedOrigins(),
      csrfTokenPresent: csrfTokenPresent(input.request.headers),
      audit: { mode: auditMode },
      now: new Date(),
    });
    const summary = summaryFromPipelineResult(input.request, input.url, result);
    recordDryRunSummary(summary);
    recordAuditStatus(auditStatusFromPipelineResult(result));
    return { status: "planned", summary, pipelineResult: result };
  } catch (error) {
    const summary = failedSummary(input.request, input.url, error);
    recordDryRunSummary(summary);
    recordAuditStatus({
      mode: "append",
      status: "failed",
      reasonCode: "dry-run-failed",
      error: error instanceof Error ? error.message : "Protected request dry-run failed",
      enforcementActive: false,
      networkExposureSafe: false,
    });
    return { status: "failed", summary };
  }
}

function recordDryRunSummary(summary: ProtectedRequestDryRunSummary): void {
  diagnostics.runCount += 1;
  diagnostics.lastResult = summary;
}

function recordAuditStatus(status: ProtectedRequestDryRunAuditStatus): void {
  if (status.status === "written") diagnostics.auditAppendCount += 1;
  diagnostics.lastAuditStatus = status;
}

async function readDryRunFlag(
  cwd: string,
): Promise<Pick<AuthConfig, "dryRunAudit" | "dryRunRequestPolicy">> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath(cwd), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<VaultConfigFile> & {
    auth?: { dryRunAudit?: unknown; dryRunRequestPolicy?: unknown };
  };
  return {
    dryRunRequestPolicy: parsed.auth?.dryRunRequestPolicy === true,
    dryRunAudit: parsed.auth?.dryRunAudit === true,
  };
}

function auditStatusFromPipelineResult(
  result: ProtectedRequestPipelineResult,
): ProtectedRequestDryRunAuditStatus {
  if (result.audit.status === "written") {
    return {
      mode: "append",
      status: "written",
      eventId: result.audit.event.eventId,
      reasonCode: result.audit.event.reasonCode,
      enforcementActive: false,
      networkExposureSafe: false,
    };
  }
  if (result.audit.status === "failed") {
    return {
      mode: "append",
      status: "failed",
      error: result.audit.error,
      enforcementActive: false,
      networkExposureSafe: false,
    };
  }
  return {
    mode: "disabled",
    status: "skipped",
    enforcementActive: false,
    networkExposureSafe: false,
  };
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
