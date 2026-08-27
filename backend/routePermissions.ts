export const ROUTE_PERMISSION_VOCABULARY = [
  "readIndex",
  "readContent",
  "writeContent",
  "deleteFiles",
  "manageVaults",
  "manageNode",
  "manageAuth",
  "readAudit",
] as const;

export type RoutePermission = (typeof ROUTE_PERMISSION_VOCABULARY)[number];

export type RoutePolicyMethod = "OPTIONS" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RoutePolicyCategory =
  | "corsPreflight"
  | "health"
  | "nodeDiagnostics"
  | "directoryBrowsing"
  | "dryRunDiagnostics"
  | "browserSessionAuth"
  | "browserSessionLogout"
  | "browserSessionRevocation"
  | "browserSessionCsrf"
  | "browserSessionPairing"
  | "credentialBootstrap"
  | "credentialListing"
  | "credentialCreation"
  | "credentialRevocation"
  | "credentialRotation"
  | "vaultListing"
  | "vaultRegistration"
  | "vaultRebind"
  | "vaultRemoval"
  | "fileListing"
  | "fileRead"
  | "vaultRuntimeStatus"
  | "storageSummary"
  | "fileWrite"
  | "fileCreate"
  | "folderCreate"
  | "rename"
  | "fileDelete"
  | "reindex"
  | "indexScopeUpdate"
  | "indexRead"
  | "indexFilters"
  | "indexSearch"
  | "indexInspect"
  | "relatedNotes";

export type StrongerConfirmation =
  | "delete"
  | "conflictOverwrite"
  | "vaultRegistration"
  | "vaultRemoval"
  | "authChange"
  | "tokenRevocation";

export type RoutePolicyDataAccess = {
  generatedIndex: boolean;
  sourceContent: boolean;
  sourceMutation: boolean;
  nodeManagement: boolean;
  authManagement: boolean;
  audit: boolean;
};

export type ConditionalRoutePermission = {
  permissions: readonly RoutePermission[];
  when: string;
};

export type ProtectedRoutePolicy = {
  method: RoutePolicyMethod;
  routePattern: string;
  category: RoutePolicyCategory;
  requiredPermissions: readonly RoutePermission[];
  conditionalPermissions?: readonly ConditionalRoutePermission[];
  anonymousReducedStatusMayExist: boolean;
  strongerConfirmation: readonly StrongerConfirmation[];
  dataAccess: RoutePolicyDataAccess;
  networkExposureSafe: false;
  notes: string;
};

const noAccess: RoutePolicyDataAccess = {
  generatedIndex: false,
  sourceContent: false,
  sourceMutation: false,
  nodeManagement: false,
  authManagement: false,
  audit: false,
};

function access(overrides: Partial<RoutePolicyDataAccess>): RoutePolicyDataAccess {
  return { ...noAccess, ...overrides };
}

export const PROTECTED_ROUTE_POLICIES = [
  {
    method: "OPTIONS",
    routePattern: "*",
    category: "corsPreflight",
    requiredPermissions: [],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({}),
    networkExposureSafe: false,
    notes: "CORS preflight is origin policy only; it must not authorize the actual request.",
  },
  {
    method: "GET",
    routePattern: "/api/health",
    category: "health",
    requiredPermissions: ["manageNode"],
    anonymousReducedStatusMayExist: true,
    strongerConfirmation: [],
    dataAccess: access({ nodeManagement: true }),
    networkExposureSafe: false,
    notes:
      "Protected mode may expose reduced anonymous liveness; full node identity requires auth.",
  },
  {
    method: "GET",
    routePattern: "/api/node/status",
    category: "nodeDiagnostics",
    requiredPermissions: ["manageNode"],
    anonymousReducedStatusMayExist: true,
    strongerConfirmation: [],
    dataAccess: access({ nodeManagement: true }),
    networkExposureSafe: false,
    notes:
      "Full diagnostics include runtime posture, warnings, vault counts, and capability flags.",
  },
  {
    method: "GET",
    routePattern: "/api/node/auth/dry-run",
    category: "dryRunDiagnostics",
    requiredPermissions: ["manageNode"],
    anonymousReducedStatusMayExist: true,
    strongerConfirmation: [],
    dataAccess: access({ nodeManagement: true }),
    networkExposureSafe: false,
    notes:
      "Diagnostic-only canary for protected-request dry-run status; future protected mode should expose only reduced anonymous fields or require manageNode.",
  },
  {
    method: "GET",
    routePattern: "/api/node/directories",
    category: "directoryBrowsing",
    requiredPermissions: ["manageVaults"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ nodeManagement: true }),
    networkExposureSafe: false,
    notes:
      "Server directory discovery exposes filesystem structure and is restricted to vault managers.",
  },
  {
    method: "POST",
    routePattern: "/api/node/auth/session",
    category: "browserSessionAuth",
    requiredPermissions: [],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes:
      "Disabled browser-session issuance stub; it must not issue cookies, sessions, CSRF tokens, or pairing codes.",
  },
  {
    method: "POST",
    routePattern: "/api/node/auth/session/logout",
    category: "browserSessionLogout",
    requiredPermissions: [],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes:
      "Disabled browser-session logout stub; it must not accept cookies as live credentials or mutate session state.",
  },
  {
    method: "POST",
    routePattern: "/api/node/auth/session/revoke-all",
    category: "browserSessionRevocation",
    requiredPermissions: [],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes:
      "Disabled browser-session revoke-all stub; it reserves the future route without revoking live sessions.",
  },
  {
    method: "GET",
    routePattern: "/api/node/auth/csrf",
    category: "browserSessionCsrf",
    requiredPermissions: [],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes:
      "Disabled CSRF endpoint stub; it must not issue CSRF tokens or imply browser-session auth is live.",
  },
  {
    method: "POST",
    routePattern: "/api/node/auth/pairing/start",
    category: "browserSessionPairing",
    requiredPermissions: [],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes: "Disabled pairing start stub; it must not create or return pairing codes.",
  },
  {
    method: "POST",
    routePattern: "/api/node/auth/pairing/complete",
    category: "browserSessionPairing",
    requiredPermissions: [],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes:
      "Disabled pairing completion stub; it must not consume pairing codes or issue session cookies.",
  },
  {
    method: "POST",
    routePattern: "/api/node/credentials/bootstrap",
    category: "credentialBootstrap",
    requiredPermissions: [],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: ["authChange"],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes:
      "Local-only first credential bootstrap is special-cased outside normal auth and must be refused once any active credential exists.",
  },
  {
    method: "GET",
    routePattern: "/api/node/credentials",
    category: "credentialListing",
    requiredPermissions: ["manageAuth"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes: "Credential listing returns sanitized metadata only and never raw token material.",
  },
  {
    method: "POST",
    routePattern: "/api/node/credentials",
    category: "credentialCreation",
    requiredPermissions: ["manageAuth"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: ["authChange"],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes:
      "Credential creation returns raw bearer material exactly once and requires confirmation.",
  },
  {
    method: "POST",
    routePattern: "/api/node/credentials/:credentialId/revoke",
    category: "credentialRevocation",
    requiredPermissions: ["manageAuth"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: ["tokenRevocation"],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes: "Credential revocation persists credential and verifier revocation metadata.",
  },
  {
    method: "POST",
    routePattern: "/api/node/credentials/:credentialId/rotate",
    category: "credentialRotation",
    requiredPermissions: ["manageAuth"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: ["authChange", "tokenRevocation"],
    dataAccess: access({ authManagement: true }),
    networkExposureSafe: false,
    notes:
      "Credential rotation creates a replacement token, revokes the old credential, and returns the replacement raw token once.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults",
    category: "vaultListing",
    requiredPermissions: [],
    conditionalPermissions: [
      {
        permissions: ["manageVaults"],
        when: "Returning full vault registration metadata, filesystem roots, or vault permissions.",
      },
    ],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true }),
    networkExposureSafe: false,
    notes:
      "Any verified protected credential may invoke discovery, but endpoint-specific response shaping exposes only granted vaults. Full registration metadata requires manageVaults; conditionalPermissions are descriptive here, not generic planner enforcement.",
  },
  {
    method: "POST",
    routePattern: "/api/vaults",
    category: "vaultRegistration",
    requiredPermissions: ["manageVaults"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: ["vaultRegistration"],
    dataAccess: access({ nodeManagement: true }),
    networkExposureSafe: false,
    notes: "Registering a vault expands AREPO filesystem reach and is administrative.",
  },
  {
    method: "DELETE",
    routePattern: "/api/vaults/:vaultId",
    category: "vaultRemoval",
    requiredPermissions: ["manageVaults"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: ["vaultRemoval"],
    dataAccess: access({ generatedIndex: true, nodeManagement: true }),
    networkExposureSafe: false,
    notes:
      "Removing a vault unregisters it from AREPO and may discard verified AREPO-generated cache; it must never delete source files.",
  },
  {
    method: "POST",
    routePattern: "/api/vaults/:vaultId/rebind",
    category: "vaultRebind",
    requiredPermissions: ["manageVaults"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: ["vaultRegistration"],
    dataAccess: access({ generatedIndex: true, nodeManagement: true }),
    networkExposureSafe: false,
    notes:
      "Rebinding changes an existing vault registration's filesystem reach while preserving its identity and policy.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults/:vaultId/files",
    category: "fileListing",
    requiredPermissions: ["readIndex"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true }),
    networkExposureSafe: false,
    notes: "File and folder names are index-like metadata, not source body content.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults/:vaultId/file?path=...",
    category: "fileRead",
    requiredPermissions: ["readContent"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ sourceContent: true }),
    networkExposureSafe: false,
    notes: "Direct supported text-file reads require source-content access.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults/:vaultId/status",
    category: "vaultRuntimeStatus",
    requiredPermissions: ["readIndex"],
    conditionalPermissions: [
      {
        permissions: ["readContent"],
        when: "A specific source path is requested with the path query parameter.",
      },
    ],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true }),
    networkExposureSafe: false,
    notes:
      "Vault-level watcher/index status is metadata; file-specific status can reveal source file state.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults/:vaultId/storage",
    category: "storageSummary",
    requiredPermissions: ["readIndex"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true }),
    networkExposureSafe: false,
    notes: "Storage summaries expose aggregate source/cache sizes, not file bodies.",
  },
  {
    method: "PUT",
    routePattern: "/api/vaults/:vaultId/file?path=...",
    category: "fileWrite",
    requiredPermissions: ["writeContent", "readContent"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: ["conflictOverwrite"],
    dataAccess: access({ sourceContent: true, sourceMutation: true }),
    networkExposureSafe: false,
    notes:
      "Writes need source read access for conflict handling and explicit overwrite confirmation.",
  },
  {
    method: "POST",
    routePattern: "/api/vaults/:vaultId/file",
    category: "fileCreate",
    requiredPermissions: ["writeContent", "readContent"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ sourceContent: true, sourceMutation: true }),
    networkExposureSafe: false,
    notes: "Creating a Markdown file writes source content.",
  },
  {
    method: "POST",
    routePattern: "/api/vaults/:vaultId/folder",
    category: "folderCreate",
    requiredPermissions: ["writeContent"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ sourceMutation: true }),
    networkExposureSafe: false,
    notes: "Folder creation changes the source tree shape without reading file bodies.",
  },
  {
    method: "POST",
    routePattern: "/api/vaults/:vaultId/rename",
    category: "rename",
    requiredPermissions: ["writeContent", "readContent"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ sourceContent: true, sourceMutation: true }),
    networkExposureSafe: false,
    notes: "Rename changes source paths and may affect source-file conflict expectations.",
  },
  {
    method: "DELETE",
    routePattern: "/api/vaults/:vaultId/file?path=...",
    category: "fileDelete",
    requiredPermissions: ["deleteFiles", "writeContent", "readContent"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: ["delete"],
    dataAccess: access({ sourceContent: true, sourceMutation: true }),
    networkExposureSafe: false,
    notes: "Delete requires a delete-specific grant; writeContent alone is not enough.",
  },
  {
    method: "POST",
    routePattern: "/api/vaults/:vaultId/reindex",
    category: "reindex",
    requiredPermissions: ["readIndex", "readContent"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true, sourceContent: true }),
    networkExposureSafe: false,
    notes:
      "Reindex reads source Markdown to rebuild generated metadata without writing source content.",
  },
  {
    method: "PATCH",
    routePattern: "/api/vaults/:vaultId/index-scope",
    category: "indexScopeUpdate",
    requiredPermissions: ["manageVaults", "readIndex", "readContent"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true, sourceContent: true, nodeManagement: true }),
    networkExposureSafe: false,
    notes:
      "Changing vaultIndexScope updates vault registration metadata and rebuilds generated index data without writing source Markdown.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults/:vaultId/index",
    category: "indexRead",
    requiredPermissions: ["readIndex"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true }),
    networkExposureSafe: false,
    notes: "Generated index data is rebuildable but may reveal sensitive metadata.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults/:vaultId/index/filters?filter=...",
    category: "indexFilters",
    requiredPermissions: ["readIndex"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true }),
    networkExposureSafe: false,
    notes: "Filter results expose generated structural metadata, not source body content.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults/:vaultId/index/search?q=...",
    category: "indexSearch",
    requiredPermissions: ["readIndex"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true }),
    networkExposureSafe: false,
    notes:
      "Current search covers generated index fields; future full-text search should require readContent.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults/:vaultId/index/inspect?path=...",
    category: "indexInspect",
    requiredPermissions: ["readIndex"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true }),
    networkExposureSafe: false,
    notes:
      "Inspect returns generated metadata such as headings, links, backlinks, tags, and issues.",
  },
  {
    method: "GET",
    routePattern: "/api/vaults/:vaultId/enrichment/related?path=...",
    category: "relatedNotes",
    requiredPermissions: ["readIndex", "readContent"],
    anonymousReducedStatusMayExist: false,
    strongerConfirmation: [],
    dataAccess: access({ generatedIndex: true, sourceContent: true }),
    networkExposureSafe: false,
    notes:
      "Related-note enrichment reads Markdown bodies and returns bounded generated candidates without source content.",
  },
] as const satisfies readonly ProtectedRoutePolicy[];
