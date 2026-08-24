import crypto from "node:crypto";
import { appendAuthAuditEvent, validateAuthAuditEvent, type AuthAuditEvent } from "./authAudit.js";
import {
  readBrowserSessionStore,
  readCredentialStore,
  readRevocationStore,
  readTokenVerifierStore,
  resolveAuthStoragePaths,
  type BrowserSessionMetadataStore,
  type CredentialMetadataStore,
  type RevocationMetadataStore,
  type TokenVerifierMetadataStore,
} from "./credentialStore.js";
import { sanitizeCredentialVerificationAuditMetadata } from "./credentialVerificationAudit.js";
import {
  planRouteAwareRequestAuthorization,
  type RequestAuthorizationDecision,
  type RequestAuthorizationPlannerInput,
} from "./requestAuthorizationPlanner.js";

export const PROTECTED_REQUEST_PIPELINE_ENFORCEMENT_ACTIVE = false;
export const PROTECTED_REQUEST_PIPELINE_NETWORK_EXPOSURE_SAFE = false;
const AUTH_STORE_LOAD_FAILED = "auth-store-load-failed";
const AUDIT_APPEND_FAILED = "audit-append-failed";

export type ProtectedRequestAuditMode = "disabled" | "dry-run" | "append";

export type ProtectedRequestPipelineInput = Omit<RequestAuthorizationPlannerInput, "stores"> & {
  appDataDir: string;
  vaultRoots?: readonly string[];
  audit?: {
    mode: ProtectedRequestAuditMode;
    eventId?: string;
    timestamp?: string;
    auditEventsPath?: string;
  };
};

export type ProtectedRequestStoreLoadStatus =
  | {
      status: "loaded";
      missingStoresTolerated: boolean;
      errors: readonly string[];
    }
  | {
      status: "failed";
      missingStoresTolerated: false;
      errors: readonly string[];
    };

export type ProtectedRequestAuditStatus =
  | { mode: "disabled"; status: "skipped"; event?: undefined; error?: undefined }
  | { mode: "dry-run"; status: "planned"; event: AuthAuditEvent; error?: undefined }
  | { mode: "append"; status: "written"; event: AuthAuditEvent; error?: undefined }
  | { mode: "append"; status: "failed"; event?: AuthAuditEvent; error: string };

export type ProtectedRequestPipelineResult = {
  storeLoad: ProtectedRequestStoreLoadStatus;
  credential: RequestAuthorizationDecision["credentialResult"];
  decision: RequestAuthorizationDecision;
  audit: ProtectedRequestAuditStatus;
  reasonCodes: readonly string[];
  enforcementActive: false;
  networkExposureSafe: false;
};

const EMPTY_STORES = {
  credentialStore: { credentials: [] } satisfies CredentialMetadataStore,
  tokenVerifierStore: { tokenVerifiers: [] } satisfies TokenVerifierMetadataStore,
  browserSessionStore: { sessions: [] } satisfies BrowserSessionMetadataStore,
  revocationStore: { revocations: [] } satisfies RevocationMetadataStore,
};

export async function planProtectedRequestPipeline(
  input: ProtectedRequestPipelineInput,
): Promise<ProtectedRequestPipelineResult> {
  const loaded = await loadStores(input.appDataDir, input.vaultRoots ?? []);
  const decision = planRouteAwareRequestAuthorization({
    request: input.request,
    stores: loaded.stores,
    vaultId: input.vaultId,
    reducedAnonymousRequested: input.reducedAnonymousRequested,
    clientPosture: input.clientPosture,
    allowedOrigins: input.allowedOrigins,
    csrfTokenPresent: input.csrfTokenPresent,
    strongerConfirmationPresent: input.strongerConfirmationPresent,
    allowedCredentialSource: input.allowedCredentialSource,
    now: input.now,
  });
  const audit = await handleAudit(input, decision);

  return {
    storeLoad: loaded.status,
    credential: decision.credentialResult,
    decision,
    audit,
    reasonCodes: [
      ...loaded.status.errors.map((error) => `store-load:${error}`),
      ...decision.reasonCodes,
      audit.status === "failed" ? `audit:${audit.error}` : undefined,
    ].filter((reason): reason is string => Boolean(reason)),
    enforcementActive: false,
    networkExposureSafe: false,
  };
}

async function loadStores(
  appDataDir: string,
  vaultRoots: readonly string[],
): Promise<{
  stores: RequestAuthorizationPlannerInput["stores"];
  status: ProtectedRequestStoreLoadStatus;
}> {
  try {
    const [credentialStore, tokenVerifierStore, browserSessionStore, revocationStore] =
      await Promise.all([
        readCredentialStore(appDataDir, vaultRoots),
        readTokenVerifierStore(appDataDir, vaultRoots),
        readBrowserSessionStore(appDataDir, vaultRoots),
        readRevocationStore(appDataDir, vaultRoots),
      ]);
    return {
      stores: { credentialStore, tokenVerifierStore, browserSessionStore, revocationStore },
      status: { status: "loaded", missingStoresTolerated: true, errors: [] },
    };
  } catch {
    return {
      stores: EMPTY_STORES,
      status: {
        status: "failed",
        missingStoresTolerated: false,
        errors: [AUTH_STORE_LOAD_FAILED],
      },
    };
  }
}

async function handleAudit(
  input: ProtectedRequestPipelineInput,
  decision: RequestAuthorizationDecision,
): Promise<ProtectedRequestAuditStatus> {
  const mode = input.audit?.mode ?? "disabled";
  if (mode === "disabled") return { mode, status: "skipped" };

  const event = buildPipelineAuditEvent(input, decision);
  if (mode === "dry-run") return { mode, status: "planned", event };

  const auditEventsPath =
    input.audit?.auditEventsPath ??
    resolveAuthStoragePaths(input.appDataDir, input.vaultRoots ?? []).auditEvents;
  try {
    await appendAuthAuditEvent(auditEventsPath, event);
    return { mode, status: "written", event };
  } catch {
    return {
      mode,
      status: "failed",
      event,
      error: AUDIT_APPEND_FAILED,
    };
  }
}

function buildPipelineAuditEvent(
  input: ProtectedRequestPipelineInput,
  decision: RequestAuthorizationDecision,
): AuthAuditEvent {
  const intent = decision.auditIntent;
  const event: AuthAuditEvent = {
    eventId: input.audit?.eventId ?? crypto.randomUUID(),
    timestamp: input.audit?.timestamp ?? new Date().toISOString(),
    kind: intent?.kind ?? "auth.attempt.rejected",
    result: decision.wouldAllow ? "accepted" : "rejected",
    reasonCode: decision.reasonCodes[0] ?? "planned-deny",
    credentialId: decision.credentialId,
    sessionId: intent?.sessionId,
    route: {
      method: input.request.method,
      pathPattern: decision.routePattern ?? input.request.routePattern ?? input.request.path,
    },
    operation: intent?.operation ?? "protectedRequestPipeline",
    metadata: sanitizeCredentialVerificationAuditMetadata({
      plannerReasonCodes: decision.reasonCodes,
      routePolicyId: decision.routePolicyId,
      requiredPermissions: decision.requiredPermissions,
      missingPermissions: decision.missingPermissions,
      requiredConfirmation: decision.requiredConfirmation,
      credentialStatus: decision.credentialResult.status,
      credentialSource: decision.credentialResult.credentialSource,
      method: input.request.method,
      path: input.request.path,
      origin: input.request.origin,
      referer: input.request.referer,
    }),
  };

  const validation = validateAuthAuditEvent(event);
  if (!validation.ok) {
    throw new Error(`Invalid protected request audit event: ${validation.errors.join(", ")}`);
  }
  return validation.event;
}
