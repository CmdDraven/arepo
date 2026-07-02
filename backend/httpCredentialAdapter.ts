import type { AuthAuditEventKind, AuthAuditResult } from "./authAudit.js";
import {
  verifySuppliedBrowserSessionCredential,
  verifySuppliedTokenCredential,
  type CredentialVerificationAuditIntent,
  type CredentialVerificationReasonCode,
  type CredentialVerificationResult,
  type CredentialVerificationStores,
} from "./credentialVerificationService.js";
import type { CredentialActorKind, VaultScopedGrant } from "./credentialStore.js";
import type { RoutePermission } from "./routePermissions.js";

export const HTTP_CREDENTIAL_ADAPTER_NETWORK_EXPOSURE_SAFE = false;
export const DEFAULT_BROWSER_SESSION_COOKIE_NAME = "arepo_session";

export type HttpCredentialSource = "bearerHeader" | "browserSessionCookie";

export type HttpCredentialAdapterReasonCode =
  | CredentialVerificationReasonCode
  | "no-credential"
  | "unsupported-authorization-scheme"
  | "multiple-authorization-values"
  | "multiple-bearer-tokens"
  | "empty-bearer-token"
  | "empty-session-cookie"
  | "ambiguous-credentials"
  | "verification-skipped";

export type RequestShapedCredentialInput = {
  method: string;
  path: string;
  routePattern?: string;
  headers?: Record<string, string | readonly string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  origin?: string;
  referer?: string;
};

export type HttpCredentialAdapterOptions = {
  verify?: boolean;
  sessionCookieName?: string;
  allowedSource?: HttpCredentialSource | "either";
  now?: Date;
};

export type HttpCredentialAdapterInput = {
  request: RequestShapedCredentialInput;
  stores: CredentialVerificationStores;
  options?: HttpCredentialAdapterOptions;
};

export type HttpCredentialAdapterAuditIntent = Omit<
  CredentialVerificationAuditIntent,
  "reasonCode" | "metadata"
> & {
  reasonCode: HttpCredentialAdapterReasonCode;
  metadata: {
    credentialSource?: HttpCredentialSource;
    method: string;
    path: string;
    routePattern?: string;
    mode?: CredentialVerificationAuditIntent["metadata"]["mode"];
    verifierId?: string;
    displayPrefix?: string;
  };
};

export type HttpCredentialAdapterVerifiedResult = {
  status: "verified";
  credentialSource: HttpCredentialSource;
  reasonCode: "verified";
  credentialId: string;
  actorKind: CredentialActorKind;
  nodePermissions: readonly RoutePermission[];
  vaultGrants: readonly VaultScopedGrant[];
  auditIntent: HttpCredentialAdapterAuditIntent;
  networkExposureSafe: false;
};

export type HttpCredentialAdapterNonVerifiedResult = {
  status: "rejected" | "not-found" | "no-credential" | "malformed" | "extracted";
  credentialSource?: HttpCredentialSource;
  reasonCode: Exclude<HttpCredentialAdapterReasonCode, "verified">;
  credentialId?: string;
  auditIntent: HttpCredentialAdapterAuditIntent;
  networkExposureSafe: false;
};

export type HttpCredentialAdapterResult =
  HttpCredentialAdapterVerifiedResult | HttpCredentialAdapterNonVerifiedResult;

type ExtractedCredential =
  | { ok: true; source: "bearerHeader"; material: string }
  | { ok: true; source: "browserSessionCookie"; material: string }
  | {
      ok: false;
      status: HttpCredentialAdapterNonVerifiedResult["status"];
      reasonCode: Exclude<HttpCredentialAdapterReasonCode, "verified">;
      source?: HttpCredentialSource;
    };

export function verifyHttpCredentialInput(
  input: HttpCredentialAdapterInput,
): HttpCredentialAdapterResult {
  const options = normalizeOptions(input.options);
  const extracted = extractCredential(input.request, options);

  if (!extracted.ok) {
    return adapterFailure(input.request, extracted.status, extracted.reasonCode, extracted.source);
  }

  if (!options.verify) {
    return {
      status: "extracted",
      credentialSource: extracted.source,
      reasonCode: "verification-skipped",
      auditIntent: adapterAuditIntent(input.request, {
        kind: "auth.attempt.rejected",
        result: "planned",
        reasonCode: "verification-skipped",
        credentialSource: extracted.source,
      }),
      networkExposureSafe: false,
    };
  }

  const verification =
    extracted.source === "bearerHeader"
      ? verifySuppliedTokenCredential({
          tokenMaterial: extracted.material,
          stores: input.stores,
          now: options.now,
        })
      : verifySuppliedBrowserSessionCredential({
          sessionSecretMaterial: extracted.material,
          stores: input.stores,
          now: options.now,
        });

  return fromVerificationResult(input.request, extracted.source, verification);
}

export function classifyHttpCredentialExtraction(
  request: RequestShapedCredentialInput,
  options: HttpCredentialAdapterOptions = {},
): HttpCredentialAdapterResult {
  return verifyHttpCredentialInput({
    request,
    stores: {
      credentialStore: { credentials: [] },
      tokenVerifierStore: { tokenVerifiers: [] },
      browserSessionStore: { sessions: [] },
      revocationStore: { revocations: [] },
    },
    options: { ...options, verify: false },
  });
}

function fromVerificationResult(
  request: RequestShapedCredentialInput,
  credentialSource: HttpCredentialSource,
  verification: CredentialVerificationResult,
): HttpCredentialAdapterResult {
  if (verification.status === "verified") {
    return {
      status: "verified",
      credentialSource,
      reasonCode: "verified",
      credentialId: verification.credentialId,
      actorKind: verification.actorKind,
      nodePermissions: verification.nodePermissions,
      vaultGrants: verification.vaultGrants,
      auditIntent: adapterAuditIntent(request, {
        ...verification.auditIntent,
        credentialSource,
      }),
      networkExposureSafe: false,
    };
  }

  return {
    status: verification.status,
    credentialSource,
    reasonCode: verification.reasonCode,
    credentialId: verification.credentialId,
    auditIntent: adapterAuditIntent(request, {
      ...verification.auditIntent,
      credentialSource,
    }),
    networkExposureSafe: false,
  };
}

function extractCredential(
  request: RequestShapedCredentialInput,
  options: Required<Pick<HttpCredentialAdapterOptions, "sessionCookieName" | "allowedSource">>,
): ExtractedCredential {
  const authHeader = headerValues(request.headers, "authorization");
  if (authHeader.length > 1) {
    return {
      ok: false,
      status: "malformed",
      reasonCode: "multiple-authorization-values",
      source: "bearerHeader",
    };
  }

  const bearer = authHeader.length === 1 ? parseAuthorization(authHeader[0] ?? "") : null;
  if (bearer?.ok === false) return bearer;

  const cookieValue = request.cookies?.[options.sessionCookieName];
  const cookieCredential =
    cookieValue === undefined ? null : parseSessionCookieCredential(cookieValue);
  if (cookieCredential?.ok === false) return cookieCredential;

  if (bearer?.ok && cookieCredential?.ok) {
    return {
      ok: false,
      status: "malformed",
      reasonCode: "ambiguous-credentials",
    };
  }

  if (bearer?.ok) {
    if (options.allowedSource === "browserSessionCookie") {
      return {
        ok: false,
        status: "malformed",
        reasonCode: "ambiguous-credentials",
        source: "bearerHeader",
      };
    }
    return bearer;
  }

  if (cookieCredential?.ok) {
    if (options.allowedSource === "bearerHeader") {
      return {
        ok: false,
        status: "malformed",
        reasonCode: "ambiguous-credentials",
        source: "browserSessionCookie",
      };
    }
    return cookieCredential;
  }

  return { ok: false, status: "no-credential", reasonCode: "no-credential" };
}

function parseAuthorization(value: string): ExtractedCredential {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: false,
      status: "malformed",
      reasonCode: "empty-bearer-token",
      source: "bearerHeader",
    };
  }
  if (/^bearer\s*$/i.test(trimmed)) {
    return {
      ok: false,
      status: "malformed",
      reasonCode: "empty-bearer-token",
      source: "bearerHeader",
    };
  }
  const match = /^(\S+)\s+(.+)$/.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      status: "malformed",
      reasonCode: "unsupported-authorization-scheme",
      source: "bearerHeader",
    };
  }
  const scheme = match[1]?.toLowerCase();
  const credential = match[2]?.trim() ?? "";
  if (scheme !== "bearer") {
    return {
      ok: false,
      status: "malformed",
      reasonCode: "unsupported-authorization-scheme",
      source: "bearerHeader",
    };
  }
  if (!credential) {
    return {
      ok: false,
      status: "malformed",
      reasonCode: "empty-bearer-token",
      source: "bearerHeader",
    };
  }
  if (credential.includes(",") || /\s+Bearer\s+/i.test(credential)) {
    return {
      ok: false,
      status: "malformed",
      reasonCode: "multiple-bearer-tokens",
      source: "bearerHeader",
    };
  }
  return { ok: true, source: "bearerHeader", material: credential };
}

function parseSessionCookieCredential(value: string): ExtractedCredential {
  const material = value.trim();
  if (!material) {
    return {
      ok: false,
      status: "malformed",
      reasonCode: "empty-session-cookie",
      source: "browserSessionCookie",
    };
  }
  return { ok: true, source: "browserSessionCookie", material };
}

function adapterFailure(
  request: RequestShapedCredentialInput,
  status: HttpCredentialAdapterNonVerifiedResult["status"],
  reasonCode: Exclude<HttpCredentialAdapterReasonCode, "verified">,
  credentialSource?: HttpCredentialSource,
): HttpCredentialAdapterNonVerifiedResult {
  return {
    status,
    credentialSource,
    reasonCode,
    auditIntent: adapterAuditIntent(request, {
      kind: "auth.attempt.rejected",
      result: "rejected",
      reasonCode,
      credentialSource,
    }),
    networkExposureSafe: false,
  };
}

function adapterAuditIntent(
  request: RequestShapedCredentialInput,
  input: {
    kind: AuthAuditEventKind;
    result: AuthAuditResult;
    reasonCode: HttpCredentialAdapterReasonCode;
    credentialId?: string;
    sessionId?: string;
    operation?: CredentialVerificationAuditIntent["operation"];
    metadata?: CredentialVerificationAuditIntent["metadata"];
    credentialSource?: HttpCredentialSource;
  },
): HttpCredentialAdapterAuditIntent {
  return {
    kind: input.kind,
    result: input.result,
    reasonCode: input.reasonCode,
    credentialId: input.credentialId,
    sessionId: input.sessionId,
    operation: input.operation ?? "verifyTokenMaterial",
    metadata: {
      credentialSource: input.credentialSource,
      method: request.method,
      path: request.path,
      routePattern: request.routePattern,
      mode: input.metadata?.mode,
      verifierId: input.metadata?.verifierId,
      displayPrefix: input.metadata?.displayPrefix,
    },
  };
}

function headerValues(
  headers: RequestShapedCredentialInput["headers"],
  name: string,
): readonly string[] {
  if (!headers) return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    if (Array.isArray(value)) {
      found.push(...value);
    } else if (typeof value === "string") {
      found.push(value);
    }
  }
  return found;
}

function normalizeOptions(
  options: HttpCredentialAdapterOptions = {},
): Required<Pick<HttpCredentialAdapterOptions, "verify" | "sessionCookieName" | "allowedSource">> &
  Pick<HttpCredentialAdapterOptions, "now"> {
  return {
    verify: options.verify ?? true,
    sessionCookieName: options.sessionCookieName ?? DEFAULT_BROWSER_SESSION_COOKIE_NAME,
    allowedSource: options.allowedSource ?? "either",
    now: options.now,
  };
}
