export type BrowserAuthFoundationRequirementId =
  | "local-first-default"
  | "localhost-only-default"
  | "single-node-self-hosting"
  | "no-mandatory-cloud-identity"
  | "server-side-session-semantics"
  | "secure-cookie-issuance-clearing"
  | "session-expiry"
  | "session-rotation"
  | "logout"
  | "revoke-current-session"
  | "revoke-all-sessions-for-subject"
  | "no-frontend-secret-storage"
  | "explicit-pairing-flow"
  | "route-contract-model"
  | "activation-gate-preflight-model"
  | "audit-without-secrets"
  | "csrf-ownership"
  | "inactive-boundary-regression"
  | "bearer-token-migration"
  | "custom-node-router-integration";

export type BrowserAuthFoundationRequirementCategory =
  "locality" | "session" | "cookie" | "csrf" | "arepo-control" | "migration" | "integration";

export type BrowserAuthFoundationRequirementOwner = "library" | "arepo" | "shared";

export type BrowserAuthFoundationRequirement = {
  id: BrowserAuthFoundationRequirementId;
  category: BrowserAuthFoundationRequirementCategory;
  owner: BrowserAuthFoundationRequirementOwner;
  description: string;
  mustProveBeforeLiveActivation: true;
};

export type BrowserAuthFoundationRequirementsDiagnostics = {
  status: "planning-only";
  requirementCount: number;
  liveBrowserAuthEnabled: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  installsRuntimeDependency: false;
  emitsSetCookieHeaders: false;
  acceptsCookieCredentials: false;
};

export const browserAuthFoundationRequirements: readonly BrowserAuthFoundationRequirement[] = [
  {
    id: "local-first-default",
    category: "locality",
    owner: "shared",
    description: "Default operation must remain local-first and compatible with disabled auth.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "localhost-only-default",
    category: "locality",
    owner: "shared",
    description: "Browser auth must preserve localhost-only assumptions until explicitly widened.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "single-node-self-hosting",
    category: "locality",
    owner: "shared",
    description:
      "Future single-node self-hosting must be possible without premature LAN safety claims.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "no-mandatory-cloud-identity",
    category: "locality",
    owner: "library",
    description: "The foundation must not require hosted accounts or cloud identity by default.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "server-side-session-semantics",
    category: "session",
    owner: "library",
    description:
      "The foundation must support server-verifiable sessions or an equivalent safe strategy.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "secure-cookie-issuance-clearing",
    category: "cookie",
    owner: "library",
    description: "Cookie issuance and clearing must support AREPO's name and attribute policy.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "session-expiry",
    category: "session",
    owner: "library",
    description: "Session expiry must be explicit, configurable, and testable.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "session-rotation",
    category: "session",
    owner: "shared",
    description: "Rotation or renewal semantics must be understood before live browser auth.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "logout",
    category: "session",
    owner: "library",
    description: "Logout must invalidate the active browser session and clear browser state.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "revoke-current-session",
    category: "session",
    owner: "library",
    description: "A selected browser session must be revocable.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "revoke-all-sessions-for-subject",
    category: "session",
    owner: "library",
    description: "All browser sessions for a principal must be revocable.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "no-frontend-secret-storage",
    category: "cookie",
    owner: "shared",
    description: "The browser UI must not persist bearer tokens or raw session secrets.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "explicit-pairing-flow",
    category: "arepo-control",
    owner: "arepo",
    description:
      "AREPO must keep a deliberate local pairing flow instead of default account signup.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "route-contract-model",
    category: "arepo-control",
    owner: "arepo",
    description: "AREPO route contracts remain the source of browser-auth route intent.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "activation-gate-preflight-model",
    category: "arepo-control",
    owner: "arepo",
    description: "Activation gates and preflight blockers must remain AREPO-owned.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "audit-without-secrets",
    category: "arepo-control",
    owner: "arepo",
    description: "Audit/status/logging must never expose tokens, cookies, hashes, or headers.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "csrf-ownership",
    category: "csrf",
    owner: "shared",
    description:
      "CSRF responsibility must be explicit before cookie-authenticated unsafe requests.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "inactive-boundary-regression",
    category: "arepo-control",
    owner: "arepo",
    description: "Inactive-boundary tests must keep planned auth unwired until activation.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "bearer-token-migration",
    category: "migration",
    owner: "shared",
    description: "Bearer-token protected mode must coexist during browser-auth migration.",
    mustProveBeforeLiveActivation: true,
  },
  {
    id: "custom-node-router-integration",
    category: "integration",
    owner: "shared",
    description: "The foundation must integrate with AREPO's custom Node request router.",
    mustProveBeforeLiveActivation: true,
  },
] as const;

export function listBrowserAuthFoundationRequirements(): readonly BrowserAuthFoundationRequirement[] {
  return browserAuthFoundationRequirements;
}

export function getBrowserAuthFoundationRequirementsDiagnostics(): BrowserAuthFoundationRequirementsDiagnostics {
  return {
    status: "planning-only",
    requirementCount: browserAuthFoundationRequirements.length,
    liveBrowserAuthEnabled: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    installsRuntimeDependency: false,
    emitsSetCookieHeaders: false,
    acceptsCookieCredentials: false,
  };
}
