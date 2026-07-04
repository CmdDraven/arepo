import type { AuthMode, BrowserSessionAuthRuntimeStatus } from "./types.js";

export type BrowserSessionAuthPlannerInput = {
  authMode: AuthMode;
  localOnlyMode: boolean;
};

export function planBrowserSessionAuth(
  _input: BrowserSessionAuthPlannerInput,
): BrowserSessionAuthRuntimeStatus {
  return {
    status: "planning-only",
    liveSessionAuth: false,
    acceptsSessionCookies: false,
    sessionIssuance: "inactive",
    csrfEnforcement: "inactive",
    sessionRoutes: "stubbed",
    pairingRoutes: "stubbed",
    csrfEndpoint: "stubbed",
    frontendTokenStorage: false,
    networkExposureSafe: false,
    cookiePolicy: {
      httpOnly: true,
      sameSite: "lax",
      secure: "required-on-https",
      devHttpException: "localhost-only-planned",
      path: "/api",
      domainAttribute: false,
    },
    pairing: {
      status: "planned",
      preferredFlow: "local-pairing-code-from-authorized-bearer",
    },
    sessionStore: {
      verifierMetadataPlanned: true,
      storesRawSessionSecrets: false,
      revocationRequired: true,
    },
    readiness: {
      ready: false,
      blockers: [
        "browser-session-auth-planning-only",
        "browser-session-cookies-not-accepted",
        "browser-session-issuance-inactive",
        "browser-session-csrf-enforcement-inactive",
        "browser-session-cookie-policy-planning-only",
        "browser-session-pairing-login-planning-only",
      ],
    },
  };
}
