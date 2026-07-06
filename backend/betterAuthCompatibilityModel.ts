import {
  browserAuthFoundationRequirements,
  type BrowserAuthFoundationRequirement,
  type BrowserAuthFoundationRequirementId,
} from "./browserAuthFoundationRequirements.js";

export type BetterAuthCompatibilityStatus =
  "compatible" | "likely-compatible" | "needs-spike" | "unknown" | "incompatible" | "out-of-scope";

export type BetterAuthCompatibilityFinding = {
  requirementId: BrowserAuthFoundationRequirementId;
  status: BetterAuthCompatibilityStatus;
  delegatedTo: "better-auth" | "arepo" | "shared" | "not-delegated";
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
  proofRequiredBeforeLiveActivation: true;
};

export type BetterAuthCompatibilityPlan = {
  status: "preferred-isolated-spike-target";
  preferredFoundation: "better-auth";
  backupFoundation: "server-side-session-core";
  liveBrowserAuthEnabled: false;
  installsRuntimeDependency: false;
  mountedInServer: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsSetCookieHeaders: false;
  acceptsCookieCredentials: false;
  parsesCookiesForLiveAuthorization: false;
  validatesCsrfInLiveAuthorization: false;
  changesBearerTokenProtectedMode: false;
  requirementCount: number;
  findings: readonly BetterAuthCompatibilityFinding[];
  summary: {
    compatibleCount: number;
    likelyCompatibleCount: number;
    needsSpikeCount: number;
    unknownCount: number;
    incompatibleCount: number;
    outOfScopeCount: number;
    blockerCodes: readonly string[];
    openQuestions: readonly string[];
  };
  nextSlice: "isolated-better-auth-dependency-proof";
};

const findingByRequirement = new Map<
  BrowserAuthFoundationRequirementId,
  Omit<BetterAuthCompatibilityFinding, "requirementId">
>([
  [
    "local-first-default",
    {
      status: "likely-compatible",
      delegatedTo: "shared",
      summary: "Better Auth can run in-app, but AREPO must keep disabled auth and local defaults.",
      blockerCodes: ["prove-local-defaults-remain-disabled"],
      openQuestions: [
        "Can the auth instance be configured without changing default AREPO startup?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "localhost-only-default",
    {
      status: "likely-compatible",
      delegatedTo: "shared",
      summary:
        "Trusted origins and cookie policy appear configurable, but AREPO must enforce locality.",
      blockerCodes: ["prove-localhost-cookie-origin-policy"],
      openQuestions: ["Which Better Auth origin checks run before AREPO activation gates?"],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "single-node-self-hosting",
    {
      status: "needs-spike",
      delegatedTo: "shared",
      summary:
        "Self-hosting is plausible with a local database, but deployment policy remains AREPO-owned.",
      blockerCodes: ["self-host-cookie-policy-unproven"],
      openQuestions: [
        "What HTTPS and Secure-cookie posture is required for non-local self-hosting?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "no-mandatory-cloud-identity",
    {
      status: "likely-compatible",
      delegatedTo: "better-auth",
      summary:
        "Better Auth supports local auth methods and does not require social/OIDC providers.",
      blockerCodes: ["local-single-operator-auth-method-unselected"],
      openQuestions: [
        "Can AREPO disable normal account signup and rely on pairing-owned issuance?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "server-side-session-semantics",
    {
      status: "likely-compatible",
      delegatedTo: "better-auth",
      summary: "Better Auth documents cookie-based sessions and database-backed session records.",
      blockerCodes: ["app-data-session-store-unproven"],
      openQuestions: [
        "Can AREPO use app-data SQLite without unexpected schema or migration behavior?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "secure-cookie-issuance-clearing",
    {
      status: "likely-compatible",
      delegatedTo: "better-auth",
      summary:
        "Cookie names and secure-cookie behavior are configurable, but AREPO attributes must be tested.",
      blockerCodes: ["cookie-attribute-proof-missing"],
      openQuestions: [
        "Can Path, SameSite, Secure, HttpOnly, and clearing behavior match AREPO policy exactly?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "session-expiry",
    {
      status: "compatible",
      delegatedTo: "better-auth",
      summary:
        "Better Auth exposes session expiry, active-session filtering, and signed-cookie expiry rejection through isolated proof boundaries.",
      blockerCodes: [
        "session-renewal-policy-needed",
        "expired-session-pruning-policy-needed",
        "backup-restore-session-state-policy-needed",
      ],
      openQuestions: [
        "What expiry/updateAge values match AREPO local-first expectations?",
        "Should AREPO run explicit expired-session cleanup during startup or maintenance?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "session-rotation",
    {
      status: "unknown",
      delegatedTo: "shared",
      summary: "Renewal/freshness exists, but AREPO still needs a rotation policy decision.",
      blockerCodes: ["session-rotation-policy-unresolved"],
      openQuestions: ["Does AREPO require token rotation, session renewal, or both?"],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "logout",
    {
      status: "likely-compatible",
      delegatedTo: "better-auth",
      summary:
        "Better Auth has session management APIs; logout behavior must be verified in the adapter.",
      blockerCodes: ["logout-cookie-clearing-proof-missing"],
      openQuestions: ["Does logout clear cookies with AREPO's exact cookie attributes?"],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "revoke-current-session",
    {
      status: "likely-compatible",
      delegatedTo: "better-auth",
      summary: "Session revocation appears aligned, but current-session mapping must be tested.",
      blockerCodes: ["revoke-current-proof-missing"],
      openQuestions: ["Can AREPO revoke by session identity without exposing session tokens?"],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "revoke-all-sessions-for-subject",
    {
      status: "likely-compatible",
      delegatedTo: "better-auth",
      summary: "Session management likely supports subject-wide invalidation or can be wrapped.",
      blockerCodes: ["revoke-all-proof-missing"],
      openQuestions: [
        "Can AREPO revoke all sessions for the local operator without normal account UX?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "no-frontend-secret-storage",
    {
      status: "likely-compatible",
      delegatedTo: "shared",
      summary:
        "Cookie-backed sessions can avoid JS-readable secrets if AREPO avoids client token storage.",
      blockerCodes: ["frontend-client-storage-contract-needed"],
      openQuestions: [
        "Which Better Auth client helpers can be used without durable frontend secret storage?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "explicit-pairing-flow",
    {
      status: "needs-spike",
      delegatedTo: "arepo",
      summary:
        "AREPO pairing should remain custom and create/attach library sessions only after proof.",
      blockerCodes: ["pairing-to-better-auth-session-unproven"],
      openQuestions: [
        "Can a local pairing proof create or attach a Better Auth session without signup UX?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "route-contract-model",
    {
      status: "compatible",
      delegatedTo: "arepo",
      summary:
        "Route contracts remain outside the auth library and can wrap any selected foundation.",
      blockerCodes: ["route-contract-wrapper-tests-needed"],
      openQuestions: [
        "Which Better Auth routes, if any, must remain behind inactive stubs until activation?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "activation-gate-preflight-model",
    {
      status: "compatible",
      delegatedTo: "arepo",
      summary: "Activation gates remain AREPO-owned and can block Better Auth mounting.",
      blockerCodes: ["mounting-gate-tests-needed"],
      openQuestions: ["Where will the final gate sit relative to Better Auth handlers?"],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "audit-without-secrets",
    {
      status: "needs-spike",
      delegatedTo: "arepo",
      summary:
        "AREPO must wrap session events and sanitize library outputs before audit/status/logging.",
      blockerCodes: ["better-auth-output-sanitization-unproven"],
      openQuestions: ["Which Better Auth response and hook data can be safely audited?"],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "csrf-ownership",
    {
      status: "compatible",
      delegatedTo: "arepo",
      summary:
        "Better Auth can own its auth endpoint protections; AREPO owns CSRF validation for arbitrary unsafe AREPO API routes.",
      blockerCodes: ["arepo-owned-csrf-live-integration-blocked"],
      openQuestions: [
        "How should the unmounted CSRF adapter proof be adapted to the eventual cookie-backed route pipeline?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "inactive-boundary-regression",
    {
      status: "compatible",
      delegatedTo: "arepo",
      summary:
        "Inactive-boundary tests can forbid Better Auth imports in live paths until activation.",
      blockerCodes: ["better-auth-boundary-tests-required"],
      openQuestions: [
        "Which import specifiers should be forbidden before a real dependency is installed?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "bearer-token-migration",
    {
      status: "likely-compatible",
      delegatedTo: "shared",
      summary:
        "Bearer-token protected mode can coexist if Better Auth stays on separate browser routes.",
      blockerCodes: ["coexistence-routing-proof-needed"],
      openQuestions: [
        "How will browser sessions map to AREPO principals without changing bearer APIs?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
  [
    "custom-node-router-integration",
    {
      status: "likely-compatible",
      delegatedTo: "shared",
      summary:
        "Better Auth exposes standard Request/Response handlers, but AREPO's router adapter is unproven.",
      blockerCodes: ["custom-router-adapter-proof-needed"],
      openQuestions: [
        "Can routeRequest convert to/from standard Request/Response without losing headers?",
      ],
      proofRequiredBeforeLiveActivation: true,
    },
  ],
]);

export function planBetterAuthCompatibility(): BetterAuthCompatibilityPlan {
  const findings = browserAuthFoundationRequirements.map((requirement) =>
    findingForRequirement(requirement),
  );
  const summary = summarize(findings);

  return {
    status: "preferred-isolated-spike-target",
    preferredFoundation: "better-auth",
    backupFoundation: "server-side-session-core",
    liveBrowserAuthEnabled: false,
    installsRuntimeDependency: false,
    mountedInServer: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsSetCookieHeaders: false,
    acceptsCookieCredentials: false,
    parsesCookiesForLiveAuthorization: false,
    validatesCsrfInLiveAuthorization: false,
    changesBearerTokenProtectedMode: false,
    requirementCount: browserAuthFoundationRequirements.length,
    findings,
    summary,
    nextSlice: "isolated-better-auth-dependency-proof",
  };
}

function findingForRequirement(
  requirement: BrowserAuthFoundationRequirement,
): BetterAuthCompatibilityFinding {
  const finding = findingByRequirement.get(requirement.id);
  if (!finding) {
    throw new Error(`Missing Better Auth compatibility finding for ${requirement.id}`);
  }
  return {
    requirementId: requirement.id,
    ...finding,
  };
}

function summarize(
  findings: readonly BetterAuthCompatibilityFinding[],
): BetterAuthCompatibilityPlan["summary"] {
  const blockerCodes = new Set<string>();
  const openQuestions = new Set<string>();
  const counts = {
    compatibleCount: 0,
    likelyCompatibleCount: 0,
    needsSpikeCount: 0,
    unknownCount: 0,
    incompatibleCount: 0,
    outOfScopeCount: 0,
  };

  for (const finding of findings) {
    for (const blocker of finding.blockerCodes) blockerCodes.add(blocker);
    for (const question of finding.openQuestions) openQuestions.add(question);
    switch (finding.status) {
      case "compatible":
        counts.compatibleCount += 1;
        break;
      case "likely-compatible":
        counts.likelyCompatibleCount += 1;
        break;
      case "needs-spike":
        counts.needsSpikeCount += 1;
        break;
      case "unknown":
        counts.unknownCount += 1;
        break;
      case "incompatible":
        counts.incompatibleCount += 1;
        break;
      case "out-of-scope":
        counts.outOfScopeCount += 1;
        break;
    }
  }

  return {
    ...counts,
    blockerCodes: [...blockerCodes].sort(),
    openQuestions: [...openQuestions].sort(),
  };
}
