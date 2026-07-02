import { planProtectedRouteAuthorization } from "./authPlanner.js";
import { planBrowserSecurity } from "./browserSecurityPolicy.js";
import { getProtectedRequestDryRunStatus } from "./protectedRequestDryRun.js";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";
import type { AuthConfig } from "./types.js";
import type { RequestPolicyRuntimeStatus } from "./types.js";

export function getRequestPolicyRuntimeStatus(auth: AuthConfig): RequestPolicyRuntimeStatus {
  const dryRunStatus = getProtectedRequestDryRunStatus(auth);
  return {
    routePolicyInventoryPresent: PROTECTED_ROUTE_POLICIES.length > 0,
    routePolicyCount: PROTECTED_ROUTE_POLICIES.length,
    browserSecurityPolicyPresent: typeof planBrowserSecurity === "function",
    authorizationPlannerPresent: typeof planProtectedRouteAuthorization === "function",
    ...dryRunStatus,
    enforcementActive: false,
    credentialVerificationActive: false,
    auditRequestLoggingActive: false,
    revocationChecksActive: false,
    csrfOriginEnforcementActive: false,
    acceptsCredentials: false,
    acceptsSessions: false,
    acceptsBearerTokens: false,
    networkExposureSafe: false,
  };
}
