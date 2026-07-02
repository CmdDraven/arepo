import { planProtectedRouteAuthorization } from "./authPlanner.js";
import { planBrowserSecurity } from "./browserSecurityPolicy.js";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";
import type { RequestPolicyRuntimeStatus } from "./types.js";

export function getRequestPolicyRuntimeStatus(): RequestPolicyRuntimeStatus {
  return {
    routePolicyInventoryPresent: PROTECTED_ROUTE_POLICIES.length > 0,
    routePolicyCount: PROTECTED_ROUTE_POLICIES.length,
    browserSecurityPolicyPresent: typeof planBrowserSecurity === "function",
    authorizationPlannerPresent: typeof planProtectedRouteAuthorization === "function",
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
