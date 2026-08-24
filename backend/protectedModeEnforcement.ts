import { loadConfig, resolveAppDataDir } from "./config.js";
import {
  auditCredentialLifecycleEvent,
  getCredentialLifecycleStatus,
} from "./credentialLifecycle.js";
import { resolveBackendRuntimeOptions, resolveAuthPosture } from "./nodeRuntime.js";
import { assessProtectedModeStartup } from "./protectedModeStartup.js";
import { buildProtectedModeReadinessManifest } from "./protectedModeReadiness.js";
import { planProtectedRequestPipeline } from "./protectedRequestPipeline.js";
import { planProtectedResponse, type ProtectedResponsePlan } from "./protectedResponsePlanner.js";
import {
  planReducedAnonymousDryRunCanary,
  planReducedAnonymousHealth,
  planReducedAnonymousNodeStatus,
  type ReducedAnonymousStatusPlan,
} from "./reducedAnonymousStatusPlanner.js";
import { getRequestPolicyRuntimeStatus } from "./requestPolicyStatus.js";
import type { RequestLike, ResponsePayload } from "./server.js";

export async function enforceProtectedMode(input: {
  request: RequestLike;
  cwd: string;
  url: URL;
  corsHeaders: Record<string, string>;
}): Promise<ResponsePayload | null> {
  const config = await loadConfig(input.cwd);
  if (config.auth.mode !== "protected") return null;

  const runtime = resolveBackendRuntimeOptions();
  const appDataDir = resolveAppDataDir(config, input.cwd);
  const vaultRoots = config.vaults.map((vault) => vault.rootPath);
  const credentialLifecycle = await getCredentialLifecycleStatus(appDataDir, vaultRoots);
  const auth = resolveAuthPosture(config.auth, runtime);
  const startup = await assessProtectedModeStartup({
    auth: config.auth,
    appDataDir,
    vaultRoots,
    runtime,
  });
  const requestPolicy = getRequestPolicyRuntimeStatus(config.auth);
  const readiness = buildProtectedModeReadinessManifest({
    auth,
    startup,
    requestPolicy,
    credentialLifecycle,
    localOnlyMode: runtime.nonLocalWarning === undefined,
  });
  const warnings = publicWarnings(readiness.protectedModeOperational, runtime.nonLocalWarning);
  const endpoint = reducedEndpoint(input.url.pathname);
  const noCredential = noCredentialSupplied(input.request);
  const bootstrapRoute =
    input.request.method === "POST" && input.url.pathname === "/api/node/credentials/bootstrap";

  if (bootstrapRoute) {
    if (!isLocalRequest(input.request)) {
      await auditCredentialLifecycleEvent(appDataDir, vaultRoots, {
        kind: "credential.bootstrap.denied",
        result: "rejected",
        reasonCode: "non-local-bootstrap-denied",
      });
      return json(
        403,
        {
          ok: false,
          error: "Credential bootstrap is only available from the local machine.",
          code: "local-bootstrap-required",
          authRequired: true,
          protectedModeOperational: readiness.protectedModeOperational,
          enforcementActive: readiness.enforcementActive,
          networkExposureSafe: false,
        },
        input.corsHeaders,
      );
    }
    if (!credentialLifecycle.storeAvailable) {
      return json(
        503,
        {
          ok: false,
          error: "Credential stores are not available for bootstrap.",
          code: "credential-store-unavailable",
          authRequired: true,
          protectedModeOperational: false,
          enforcementActive: false,
          networkExposureSafe: false,
        },
        input.corsHeaders,
      );
    }
    if (credentialLifecycle.activeCredentialCount > 0) {
      await auditCredentialLifecycleEvent(appDataDir, vaultRoots, {
        kind: "credential.bootstrap.denied",
        result: "rejected",
        reasonCode: "active-credential-exists",
      });
      return json(
        409,
        {
          ok: false,
          error: "Credential bootstrap is only available when no active credentials exist.",
          code: "active-credential-exists",
          authRequired: true,
          protectedModeOperational: readiness.protectedModeOperational,
          enforcementActive: readiness.enforcementActive,
          networkExposureSafe: false,
        },
        input.corsHeaders,
      );
    }
    return null;
  }

  if (!readiness.readyForEnforcement) {
    if (endpoint) {
      return json(503, reducedStatusBody(endpoint, warnings), input.corsHeaders);
    }
    return json(
      503,
      {
        ok: false,
        error: "Protected mode is configured but not operational.",
        code: "protected-mode-not-ready",
        reasonCodes: ["protected-mode-not-ready", ...readiness.blockers],
        authRequired: true,
        protectedModeOperational: false,
        enforcementActive: false,
        networkExposureSafe: false,
      },
      input.corsHeaders,
    );
  }

  if (endpoint === "dryRunCanary" && noCredential && config.auth.dryRunRequestPolicy === true) {
    return null;
  }

  const pipeline = await planProtectedRequestPipeline({
    appDataDir,
    vaultRoots,
    request: {
      method: input.request.method ?? "GET",
      path: input.url.pathname,
      headers: plannerHeaders(input.request.headers),
      cookies: parseCookieHeader(headerValue(input.request.headers, "cookie")),
      origin: headerValue(input.request.headers, "origin"),
      referer: headerValue(input.request.headers, "referer"),
    },
    vaultId: vaultIdFromPath(input.url.pathname),
    allowedOrigins: runtime.allowedOrigins,
    csrfTokenPresent: csrfTokenPresent(input.request.headers),
    strongerConfirmationPresent: strongerConfirmationPresent(input.request.headers),
    reducedAnonymousRequested: Boolean(endpoint && noCredential),
    allowedCredentialSource: "bearerHeader",
    audit: { mode: "append" },
    now: new Date(),
  });
  const responsePlan = planProtectedResponse({
    pipelineResult: pipeline,
    protectedModeReady: readiness.readyForEnforcement,
  });

  if (responsePlan.kind === "allow") return null;
  if (responsePlan.kind === "reduced-anonymous" && endpoint) {
    return json(200, reducedStatusBody(endpoint, warnings), input.corsHeaders);
  }

  return json(
    responsePlan.httpStatus,
    protectedErrorBody(responsePlan, readiness.protectedModeOperational),
    input.corsHeaders,
  );
}

function protectedErrorBody(
  plan: ProtectedResponsePlan,
  protectedModeOperational: boolean,
): Record<string, unknown> {
  return {
    ok: false,
    error: errorMessageForPlan(plan),
    code: plan.body.reasonCode,
    reasonCodes: plan.body.reasonCodes,
    authRequired: plan.body.authRequired,
    authorizationRequired: plan.body.authorizationRequired,
    csrfRequired: plan.body.csrfRequired,
    originRejected: plan.body.originRejected,
    confirmationRequired: plan.body.confirmationRequired,
    requiredConfirmation: plan.body.requiredConfirmation,
    protectedModeOperational,
    enforcementActive: protectedModeOperational,
    networkExposureSafe: false,
  };
}

function errorMessageForPlan(plan: ProtectedResponsePlan): string {
  switch (plan.kind) {
    case "unauthenticated":
      return "Authentication required.";
    case "unauthorized":
      return "Credential is not authorized for this route.";
    case "csrf-required":
      return "CSRF validation is required for this route.";
    case "origin-rejected":
      return "Origin is not allowed for this route.";
    case "stronger-confirmation-required":
      return "Stronger confirmation is required for this route.";
    case "not-found-or-unknown-route":
      return "Not found.";
    case "service-unavailable-or-not-ready":
      return "Protected mode is not operational.";
    default:
      return "Protected request denied.";
  }
}

function reducedStatusBody(
  endpoint: "health" | "nodeStatus" | "dryRunCanary",
  warnings: readonly string[],
): ReducedAnonymousStatusPlan {
  if (endpoint === "health") return planReducedAnonymousHealth({ publicWarnings: warnings });
  if (endpoint === "dryRunCanary") {
    return planReducedAnonymousDryRunCanary({ publicWarnings: warnings });
  }
  return planReducedAnonymousNodeStatus({ publicWarnings: warnings });
}

function reducedEndpoint(pathname: string): "health" | "nodeStatus" | "dryRunCanary" | null {
  if (pathname === "/api/health") return "health";
  if (pathname === "/api/node/status") return "nodeStatus";
  if (pathname === "/api/node/auth/dry-run") return "dryRunCanary";
  return null;
}

function publicWarnings(
  protectedModeOperational: boolean,
  nonLocalWarning: string | undefined,
): string[] {
  return [
    "auth-required",
    "protected-mode-required",
    protectedModeOperational ? undefined : "protected-mode-not-operational",
    nonLocalWarning ? "non-local-bind-unsafe" : undefined,
  ].filter((warning): warning is string => Boolean(warning));
}

function noCredentialSupplied(request: RequestLike): boolean {
  return !headerValue(request.headers, "authorization") && !headerValue(request.headers, "cookie");
}

function plannerHeaders(
  headers: RequestLike["headers"],
): Record<string, string | readonly string[] | undefined> {
  const out: Record<string, string | readonly string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers ?? {})) out[key] = value;
  return out;
}

function parseCookieHeader(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const cookies: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [rawKey, ...rawRest] = part.split("=");
    const key = rawKey?.trim();
    if (!key) continue;
    cookies[key] = rawRest.join("=").trim();
  }
  return cookies;
}

function headerValue(headers: RequestLike["headers"], name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function csrfTokenPresent(headers: RequestLike["headers"]): boolean {
  return Boolean(headerValue(headers, "x-arepo-csrf") || headerValue(headers, "x-csrf-token"));
}

function strongerConfirmationPresent(headers: RequestLike["headers"]): boolean {
  return headerValue(headers, "x-arepo-confirmation") === "confirm";
}

function isLocalRequest(request: RequestLike): boolean {
  const remoteAddress = request.socket?.remoteAddress;
  return (
    remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1"
  );
}

function vaultIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/vaults\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ResponsePayload {
  return { status, body, headers };
}
