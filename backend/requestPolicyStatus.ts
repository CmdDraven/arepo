import { planProtectedRouteAuthorization } from "./authPlanner.js";
import { planBrowserSecurity } from "./browserSecurityPolicy.js";
import { getProtectedRequestDryRunStatus } from "./protectedRequestDryRun.js";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";
import type { AuthConfig } from "./types.js";
import type { RequestPolicyRuntimeStatus } from "./types.js";

export function getRequestPolicyRuntimeStatus(auth: AuthConfig): RequestPolicyRuntimeStatus {
  const dryRunStatus = getProtectedRequestDryRunStatus(auth);
  const protectedMode = auth.mode === "protected";
  return {
    routePolicyInventoryPresent: PROTECTED_ROUTE_POLICIES.length > 0,
    routePolicyCount: PROTECTED_ROUTE_POLICIES.length,
    browserSecurityPolicyPresent: typeof planBrowserSecurity === "function",
    authorizationPlannerPresent: typeof planProtectedRouteAuthorization === "function",
    ...dryRunStatus,
    enforcementActive: protectedMode,
    enforced: protectedMode,
    credentialVerificationActive: protectedMode,
    auditRequestLoggingActive: protectedMode,
    revocationChecksActive: protectedMode,
    csrfOriginEnforcementActive: false,
    acceptsCredentials: protectedMode,
    acceptsSessions: false,
    acceptsBearerTokens: protectedMode,
    networkExposureSafe: false,
  };
}
