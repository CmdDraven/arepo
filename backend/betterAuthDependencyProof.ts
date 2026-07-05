import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { betterAuth } from "better-auth/minimal";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";

export const BETTER_AUTH_DEPENDENCY_PROOF_MOUNTED = false;
export const BETTER_AUTH_DEPENDENCY_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_DEPENDENCY_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_DEPENDENCY_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthProofFindingStatus = "passed" | "modeled" | "needs-adapter-spike" | "unknown";

export type BetterAuthProofFinding = {
  id:
    | "import-and-instantiate"
    | "request-response-handler"
    | "custom-node-router-adaptation"
    | "cookie-policy-control"
    | "session-creation"
    | "session-lookup"
    | "session-expiry"
    | "logout-signout"
    | "revoke-current"
    | "revoke-all"
    | "local-app-data-storage"
    | "csrf-ownership"
    | "output-sanitization";
  status: BetterAuthProofFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

export type BetterAuthCookieAttributeSummary = {
  name: string;
  path: string;
  sameSite: string;
  httpOnly: boolean;
  secure: boolean;
  maxAgeSeconds: number | null;
  valueRedacted: true;
};

export type BetterAuthClearingCookieSummary = {
  name: string;
  path: string | null;
  sameSite: string | null;
  httpOnly: boolean;
  secure: boolean;
  maxAgeSeconds: number | null;
  valueRedacted: true;
};

export type BetterAuthDependencyProofResult = {
  status: "isolated-proof";
  packageName: "better-auth";
  packageVersion: string;
  dependencyInstalled: true;
  importedBetterAuth: true;
  instantiatedBetterAuth: true;
  importedNodeHandlerHelpers: boolean;
  liveBrowserAuthEnabled: false;
  mountedInServer: false;
  mountedHandler: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsLiveSetCookieHeaders: false;
  acceptsCookieCredentialsInLiveAuth: false;
  parsesCookiesForLiveAuthorization: false;
  validatesCsrfInLiveAuthorization: false;
  changesBearerTokenProtectedMode: false;
  noPluginsEnabled: true;
  emailAndPasswordEnabled: false;
  socialProvidersEnabled: false;
  publicHandlerShape: {
    standardRequestResponseHandler: boolean;
    nodeHandlerAdapterAvailable: boolean;
    fromNodeHeadersAvailable: boolean;
  };
  cookiePolicy: {
    configuredSessionCookie: BetterAuthCookieAttributeSummary;
    trustedOrigins: readonly string[];
    useSecureCookies: boolean;
  };
  requestProof: {
    getSessionWithoutCookieStatus: number;
    getSessionWithoutCookieReturnedNull: boolean;
    signOutWithoutSessionStatus: number;
    signOutClearingCookieCount: number;
    clearingCookies: readonly BetterAuthClearingCookieSummary[];
  };
  sessionProof: {
    userCreatedThroughInternalAdapter: boolean;
    sessionCreatedThroughInternalAdapter: boolean;
    sessionLookupThroughInternalAdapter: boolean;
    revokeCurrentThroughInternalAdapter: boolean;
    revokeAllThroughInternalAdapter: boolean;
    directCookieInjectionAuthenticates: boolean;
    directPairingToPublicSessionApi: "needs-adapter-spike";
    usesExternalIdentityProvider: false;
    appDataStorage: "needs-database-adapter-spike";
    expirySeconds: number;
    refreshUpdateAgeSeconds: number;
  };
  csrfProof: {
    coveredForArepoUnsafeApiRoutes: "unknown";
    likelyArepoOwnedUntilProven: true;
    blockerCodes: readonly ["csrf-ownership-unresolved"];
  };
  findings: readonly BetterAuthProofFinding[];
};

const baseUrl = "http://127.0.0.1:8734";
const sessionCookieName = "arepo_session";

export async function runIsolatedBetterAuthDependencyProof(): Promise<BetterAuthDependencyProofResult> {
  const auth = betterAuth({
    secret: "arepo-better-auth-proof-secret-0123456789abcdef",
    baseURL: baseUrl,
    trustedOrigins: [baseUrl],
    emailAndPassword: { enabled: false },
    socialProviders: {},
    rateLimit: { enabled: false },
    advanced: {
      useSecureCookies: false,
      cookies: {
        session_token: {
          name: sessionCookieName,
          attributes: {
            httpOnly: true,
            sameSite: "lax",
            path: "/api",
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 30,
      updateAge: 60 * 5,
    },
  });

  const context = await auth.$context;
  const sessionCookie = context.authCookies.sessionToken;
  const getSessionWithoutCookie = await auth.handler(
    new Request(`${baseUrl}/api/auth/get-session`),
  );
  const getSessionWithoutCookieBody = await safeJson(getSessionWithoutCookie);
  const signOutWithoutSession = await auth.handler(
    new Request(`${baseUrl}/api/auth/sign-out`, { method: "POST" }),
  );
  const clearingCookies = summarizeSetCookieHeaders(signOutWithoutSession.headers);

  const user = await context.internalAdapter.createUser({
    email: "arepo-local-operator@example.invalid",
    name: "AREPO Local Operator",
    emailVerified: true,
  });
  const firstSession = await context.internalAdapter.createSession(user.id);
  const foundFirstSession = await context.internalAdapter.findSession(firstSession.token);
  await context.internalAdapter.deleteSession(firstSession.token);
  const revokedFirstSession = await context.internalAdapter.findSession(firstSession.token);
  const secondSession = await context.internalAdapter.createSession(user.id);
  const thirdSession = await context.internalAdapter.createSession(user.id);
  await context.internalAdapter.deleteUserSessions(user.id);
  const revokedSecondSession = await context.internalAdapter.findSession(secondSession.token);
  const revokedThirdSession = await context.internalAdapter.findSession(thirdSession.token);
  const directCookieInjection = await auth.handler(
    new Request(`${baseUrl}/api/auth/get-session`, {
      headers: { cookie: `${sessionCookieName}=${firstSession.token}` },
    }),
  );
  const directCookieInjectionBody = await safeJson(directCookieInjection);

  return {
    status: "isolated-proof",
    packageName: "better-auth",
    packageVersion: betterAuthPackageVersion(),
    dependencyInstalled: true,
    importedBetterAuth: true,
    instantiatedBetterAuth: true,
    importedNodeHandlerHelpers:
      typeof toNodeHandler === "function" && typeof fromNodeHeaders === "function",
    liveBrowserAuthEnabled: false,
    mountedInServer: false,
    mountedHandler: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsLiveSetCookieHeaders: false,
    acceptsCookieCredentialsInLiveAuth: false,
    parsesCookiesForLiveAuthorization: false,
    validatesCsrfInLiveAuthorization: false,
    changesBearerTokenProtectedMode: false,
    noPluginsEnabled: true,
    emailAndPasswordEnabled: false,
    socialProvidersEnabled: false,
    publicHandlerShape: {
      standardRequestResponseHandler: typeof auth.handler === "function",
      nodeHandlerAdapterAvailable: typeof toNodeHandler === "function",
      fromNodeHeadersAvailable: typeof fromNodeHeaders === "function",
    },
    cookiePolicy: {
      configuredSessionCookie: {
        name: sessionCookie.name,
        path: sessionCookie.attributes.path ?? "/",
        sameSite: String(sessionCookie.attributes.sameSite),
        httpOnly: Boolean(sessionCookie.attributes.httpOnly),
        secure: Boolean(sessionCookie.attributes.secure),
        maxAgeSeconds:
          typeof sessionCookie.attributes.maxAge === "number"
            ? sessionCookie.attributes.maxAge
            : null,
        valueRedacted: true,
      },
      trustedOrigins: [baseUrl],
      useSecureCookies: false,
    },
    requestProof: {
      getSessionWithoutCookieStatus: getSessionWithoutCookie.status,
      getSessionWithoutCookieReturnedNull: getSessionWithoutCookieBody === null,
      signOutWithoutSessionStatus: signOutWithoutSession.status,
      signOutClearingCookieCount: clearingCookies.length,
      clearingCookies,
    },
    sessionProof: {
      userCreatedThroughInternalAdapter: true,
      sessionCreatedThroughInternalAdapter: true,
      sessionLookupThroughInternalAdapter: Boolean(foundFirstSession),
      revokeCurrentThroughInternalAdapter: revokedFirstSession === null,
      revokeAllThroughInternalAdapter:
        revokedSecondSession === null && revokedThirdSession === null,
      directCookieInjectionAuthenticates: directCookieInjectionBody !== null,
      directPairingToPublicSessionApi: "needs-adapter-spike",
      usesExternalIdentityProvider: false,
      appDataStorage: "needs-database-adapter-spike",
      expirySeconds: context.sessionConfig.expiresIn,
      refreshUpdateAgeSeconds: context.sessionConfig.updateAge,
    },
    csrfProof: {
      coveredForArepoUnsafeApiRoutes: "unknown",
      likelyArepoOwnedUntilProven: true,
      blockerCodes: ["csrf-ownership-unresolved"],
    },
    findings: buildFindings({
      getSessionWithoutCookieStatus: getSessionWithoutCookie.status,
      getSessionWithoutCookieReturnedNull: getSessionWithoutCookieBody === null,
      signOutWithoutSessionStatus: signOutWithoutSession.status,
      signOutClearingCookieCount: clearingCookies.length,
      sessionLookup: Boolean(foundFirstSession),
      revokeCurrent: revokedFirstSession === null,
      revokeAll: revokedSecondSession === null && revokedThirdSession === null,
    }),
  };
}

function buildFindings(input: {
  getSessionWithoutCookieStatus: number;
  getSessionWithoutCookieReturnedNull: boolean;
  signOutWithoutSessionStatus: number;
  signOutClearingCookieCount: number;
  sessionLookup: boolean;
  revokeCurrent: boolean;
  revokeAll: boolean;
}): readonly BetterAuthProofFinding[] {
  return [
    {
      id: "import-and-instantiate",
      status: "passed",
      summary: "Better Auth imports and instantiates in the AREPO backend TypeScript environment.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "request-response-handler",
      status:
        input.getSessionWithoutCookieStatus === 200 && input.getSessionWithoutCookieReturnedNull
          ? "passed"
          : "needs-adapter-spike",
      summary: "The Better Auth standard Request/Response handler can be called without Express.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "custom-node-router-adaptation",
      status: "needs-adapter-spike",
      summary:
        "Better Auth exposes a standard handler and Node helpers, but routeRequest adaptation is not built.",
      blockerCodes: ["custom-router-adapter-proof-needed"],
      openQuestions: [
        "How should AREPO convert routeRequest inputs and Better Auth Response outputs safely?",
      ],
    },
    {
      id: "cookie-policy-control",
      status: "passed",
      summary: "The isolated instance can configure the session cookie name and core attributes.",
      blockerCodes: [],
      openQuestions: ["Secure-cookie behavior for non-local HTTPS still needs a dedicated proof."],
    },
    {
      id: "session-creation",
      status: "needs-adapter-spike",
      summary:
        "A session can be created through Better Auth internals, but pairing-to-public-session creation is unproven.",
      blockerCodes: ["pairing-to-better-auth-session-unproven"],
      openQuestions: [
        "Which supported Better Auth API should AREPO use to attach a session after local pairing?",
      ],
    },
    {
      id: "session-lookup",
      status: input.sessionLookup ? "passed" : "needs-adapter-spike",
      summary:
        "The isolated proof can look up an internally created session without exposing its token.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "session-expiry",
      status: "modeled",
      summary:
        "Expiry and refresh settings are configurable and visible; deterministic expiry behavior needs adapter tests.",
      blockerCodes: ["expiry-runtime-proof-needed"],
      openQuestions: ["How should Better Auth test time be controlled in an integration proof?"],
    },
    {
      id: "logout-signout",
      status:
        input.signOutWithoutSessionStatus === 200 && input.signOutClearingCookieCount > 0
          ? "passed"
          : "needs-adapter-spike",
      summary: "The sign-out handler emits cookie-clearing behavior in the isolated proof.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-current",
      status: input.revokeCurrent ? "passed" : "needs-adapter-spike",
      summary: "The isolated proof can delete one internally created session.",
      blockerCodes: [],
      openQuestions: ["How should this map to a supported public/session API in production?"],
    },
    {
      id: "revoke-all",
      status: input.revokeAll ? "passed" : "needs-adapter-spike",
      summary: "The isolated proof can delete all sessions for one internal user.",
      blockerCodes: [],
      openQuestions: [
        "How should AREPO map a local operator principal to Better Auth user/session records?",
      ],
    },
    {
      id: "local-app-data-storage",
      status: "needs-adapter-spike",
      summary:
        "This proof uses Better Auth's default isolated storage path, not AREPO app-data SQLite.",
      blockerCodes: ["app-data-session-store-unproven"],
      openQuestions: ["Which SQLite adapter should AREPO use under appDataDir?"],
    },
    {
      id: "csrf-ownership",
      status: "unknown",
      summary: "This proof does not show CSRF protection for arbitrary AREPO unsafe API routes.",
      blockerCodes: ["csrf-ownership-unresolved"],
      openQuestions: [
        "Does Better Auth protect only its own routes, or can it cover AREPO's unsafe routes?",
      ],
    },
    {
      id: "output-sanitization",
      status: "passed",
      summary:
        "The proof result contains only redacted cookie summaries and no raw token material.",
      blockerCodes: [],
      openQuestions: [],
    },
  ];
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  return JSON.parse(text) as unknown;
}

function summarizeSetCookieHeaders(headers: Headers): readonly BetterAuthClearingCookieSummary[] {
  return headers.getSetCookie().map((header) => summarizeSetCookie(header));
}

function summarizeSetCookie(header: string): BetterAuthClearingCookieSummary {
  const [nameValue = "", ...attributeParts] = header.split(";").map((part) => part.trim());
  const [name = ""] = nameValue.split("=");
  const attributes = new Map<string, string | true>();
  for (const part of attributeParts) {
    const [key = "", value] = part.split("=");
    attributes.set(key.toLowerCase(), value ?? true);
  }
  return {
    name,
    path: stringAttribute(attributes, "path"),
    sameSite: stringAttribute(attributes, "samesite"),
    httpOnly: attributes.has("httponly"),
    secure: attributes.has("secure"),
    maxAgeSeconds: numberAttribute(attributes, "max-age"),
    valueRedacted: true,
  };
}

function stringAttribute(attributes: Map<string, string | true>, key: string): string | null {
  const value = attributes.get(key);
  return typeof value === "string" ? value : null;
}

function numberAttribute(attributes: Map<string, string | true>, key: string): number | null {
  const value = attributes.get(key);
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function betterAuthPackageVersion(): string {
  const require = createRequire(import.meta.url);
  const entrypoint = require.resolve("better-auth");
  const packageJsonPath = path.resolve(entrypoint, "..", "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };
  return typeof packageJson.version === "string" ? packageJson.version : "unknown";
}
