import crypto from "node:crypto";
import { appendAuthAuditEvent, type AuthAuditEvent, type AuthAuditEventKind } from "./authAudit.js";
import {
  readBrowserSessionStore,
  readCredentialStore,
  readRevocationStore,
  readTokenVerifierStore,
  resolveAuthStoragePaths,
  writeBrowserSessionStore,
  writeCredentialStore,
  writeRevocationStore,
  writeTokenVerifierStore,
  type BrowserSessionMetadataStore,
  type CredentialMetadata,
  type CredentialMetadataStore,
  type RevocationMetadata,
  type RevocationMetadataStore,
  type TokenVerifierMetadataStore,
  type VaultScopedGrant,
} from "./credentialStore.js";
import { createTokenVerifierMetadata } from "./credentialVerifier.js";
import { ROUTE_PERMISSION_VOCABULARY, type RoutePermission } from "./routePermissions.js";
import type { VaultInfo } from "./types.js";

export type CredentialLifecycleStatus = {
  storeAvailable: boolean;
  activeCredentialCount: number;
  revokedCredentialCount: number;
  expiredCredentialCount: number;
  totalCredentialCount: number;
  bootstrapAvailable: boolean;
  error?: string;
};

export type SafeCredentialStatus = "active" | "expired" | "revoked";

export type SafeCredentialSummary = {
  credentialId: string;
  label: string;
  actorKind: CredentialMetadata["actorKind"];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  nodePermissions: readonly RoutePermission[];
  vaultGrants: readonly VaultScopedGrant[];
  status: SafeCredentialStatus;
  verifierCount: number;
  sessionCount: number;
};

export type CredentialIssueResult = {
  credential: SafeCredentialSummary;
  bearerToken: string;
  tokenType: "Bearer";
};

export type CredentialRevokeResult = {
  credential: SafeCredentialSummary;
  revoked: boolean;
};

export type CredentialRotateResult = {
  oldCredential: SafeCredentialSummary;
  credential: SafeCredentialSummary;
  bearerToken: string;
  tokenType: "Bearer";
};

type Stores = {
  credentialStore: CredentialMetadataStore;
  tokenVerifierStore: TokenVerifierMetadataStore;
  browserSessionStore: BrowserSessionMetadataStore;
  revocationStore: RevocationMetadataStore;
};

type CredentialRequest = {
  label: string;
  expiresAt?: string;
  nodePermissions: readonly RoutePermission[];
  vaultGrants: readonly VaultScopedGrant[];
};

const nodeAdminPermissions: readonly RoutePermission[] = [
  "manageNode",
  "manageAuth",
  "manageVaults",
  "readAudit",
];

const vaultAdminPermissions: readonly RoutePermission[] = [
  "readIndex",
  "readContent",
  "writeContent",
  "deleteFiles",
];

export async function getCredentialLifecycleStatus(
  appDataDir: string,
  vaultRoots: readonly string[] = [],
  now = new Date(),
): Promise<CredentialLifecycleStatus> {
  try {
    const stores = await readStores(appDataDir, vaultRoots);
    const summaries = summarizeCredentials(stores, now);
    const activeCredentialCount = summaries.filter((item) => item.status === "active").length;
    return {
      storeAvailable: true,
      activeCredentialCount,
      revokedCredentialCount: summaries.filter((item) => item.status === "revoked").length,
      expiredCredentialCount: summaries.filter((item) => item.status === "expired").length,
      totalCredentialCount: summaries.length,
      bootstrapAvailable: activeCredentialCount === 0,
    };
  } catch (error) {
    return {
      storeAvailable: false,
      activeCredentialCount: 0,
      revokedCredentialCount: 0,
      expiredCredentialCount: 0,
      totalCredentialCount: 0,
      bootstrapAvailable: false,
      error: error instanceof Error ? error.message : "credential lifecycle status unavailable",
    };
  }
}

export async function bootstrapBearerCredential(input: {
  appDataDir: string;
  vaultRoots?: readonly string[];
  vaults?: readonly VaultInfo[];
  body: Record<string, unknown>;
  now?: Date;
}): Promise<CredentialIssueResult> {
  const vaultRoots = input.vaultRoots ?? [];
  const now = input.now ?? new Date();
  const stores = await readStores(input.appDataDir, vaultRoots);
  const status = getLifecycleStatusFromStores(stores, now);
  if (status.activeCredentialCount > 0) {
    await auditCredentialLifecycleEvent(input.appDataDir, vaultRoots, {
      kind: "credential.bootstrap.denied",
      result: "rejected",
      reasonCode: "active-credential-exists",
    });
    throw httpError(
      409,
      "Credential bootstrap is only available when no active credentials exist.",
    );
  }

  await auditCredentialLifecycleEvent(input.appDataDir, vaultRoots, {
    kind: "credential.bootstrap.attempted",
    result: "planned",
    reasonCode: "bootstrap-requested",
  });
  const result = await issueCredential({
    appDataDir: input.appDataDir,
    vaultRoots,
    stores,
    request: parseCredentialRequest(input.body, input.vaults ?? []),
    now,
    reasonCode: "credential-bootstrap-succeeded",
    auditKind: "credential.bootstrap.succeeded",
  });
  return result;
}

export async function createBearerCredential(input: {
  appDataDir: string;
  vaultRoots?: readonly string[];
  vaults?: readonly VaultInfo[];
  body: Record<string, unknown>;
  now?: Date;
}): Promise<CredentialIssueResult> {
  const vaultRoots = input.vaultRoots ?? [];
  const stores = await readStores(input.appDataDir, vaultRoots);
  return issueCredential({
    appDataDir: input.appDataDir,
    vaultRoots,
    stores,
    request: parseCredentialRequest(input.body, input.vaults ?? []),
    now: input.now ?? new Date(),
    reasonCode: "credential-created",
    auditKind: "credential.created",
  });
}

export async function listCredentials(input: {
  appDataDir: string;
  vaultRoots?: readonly string[];
  now?: Date;
}): Promise<{
  credentials: readonly SafeCredentialSummary[];
  status: CredentialLifecycleStatus;
}> {
  const vaultRoots = input.vaultRoots ?? [];
  const stores = await readStores(input.appDataDir, vaultRoots);
  const now = input.now ?? new Date();
  return {
    credentials: summarizeCredentials(stores, now),
    status: getLifecycleStatusFromStores(stores, now),
  };
}

export async function revokeCredential(input: {
  appDataDir: string;
  vaultRoots?: readonly string[];
  credentialId: string;
  reason?: string;
  now?: Date;
}): Promise<CredentialRevokeResult> {
  const vaultRoots = input.vaultRoots ?? [];
  const stores = await readStores(input.appDataDir, vaultRoots);
  const now = input.now ?? new Date();
  const revokedAt = now.toISOString();
  const index = stores.credentialStore.credentials.findIndex(
    (credential) => credential.credentialId === input.credentialId,
  );
  if (index < 0) throw httpError(404, "Credential not found.");

  const credentials = [...stores.credentialStore.credentials];
  const existing = credentials[index] as CredentialMetadata;
  const alreadyRevoked = isCredentialRevoked(existing, stores.revocationStore);
  if (!alreadyRevoked) {
    const credential = { ...existing, revokedAt };
    credentials[index] = credential;
    const verifierIds = new Set(credential.verifierIds);
    const tokenVerifiers = stores.tokenVerifierStore.tokenVerifiers.map((verifier) =>
      verifier.credentialId === credential.credentialId || verifierIds.has(verifier.verifierId)
        ? { ...verifier, revokedAt }
        : verifier,
    );
    const revocations = [
      ...stores.revocationStore.revocations,
      revocation("credential", credential.credentialId, revokedAt, input.reason),
      ...credential.verifierIds.map((verifierId) =>
        revocation("tokenVerifier", verifierId, revokedAt, input.reason),
      ),
    ];
    await Promise.all([
      writeCredentialStore(input.appDataDir, { credentials }, vaultRoots),
      writeTokenVerifierStore(input.appDataDir, { tokenVerifiers }, vaultRoots),
      writeRevocationStore(input.appDataDir, { revocations }, vaultRoots),
      writeBrowserSessionStore(input.appDataDir, stores.browserSessionStore, vaultRoots),
    ]);
    await auditCredentialLifecycleEvent(input.appDataDir, vaultRoots, {
      kind: "credential.revoked",
      result: "revoked",
      reasonCode: "credential-revoked",
      credentialId: credential.credentialId,
    });
  }

  const latest = await readStores(input.appDataDir, vaultRoots);
  const summary = summarizeCredentials(latest, now).find(
    (credential) => credential.credentialId === input.credentialId,
  );
  if (!summary) throw httpError(404, "Credential not found.");
  return { credential: summary, revoked: !alreadyRevoked };
}

export async function rotateCredential(input: {
  appDataDir: string;
  vaultRoots?: readonly string[];
  credentialId: string;
  body: Record<string, unknown>;
  now?: Date;
}): Promise<CredentialRotateResult> {
  const vaultRoots = input.vaultRoots ?? [];
  const stores = await readStores(input.appDataDir, vaultRoots);
  const now = input.now ?? new Date();
  const oldCredential = stores.credentialStore.credentials.find(
    (credential) => credential.credentialId === input.credentialId,
  );
  if (!oldCredential) throw httpError(404, "Credential not found.");
  if (isCredentialRevoked(oldCredential, stores.revocationStore)) {
    throw httpError(409, "Credential is already revoked.");
  }

  const request = parseCredentialRequest(
    {
      label: `${oldCredential.label} rotation`,
      expiresAt: oldCredential.expiresAt,
      nodePermissions: oldCredential.nodePermissions,
      vaultGrants: oldCredential.vaultGrants,
      ...input.body,
    },
    [],
  );
  const issued = buildCredential(request, now);
  const revokedAt = now.toISOString();
  const credentials = stores.credentialStore.credentials.map((credential) =>
    credential.credentialId === oldCredential.credentialId
      ? { ...credential, revokedAt }
      : credential,
  );
  const tokenVerifiers = [
    ...stores.tokenVerifierStore.tokenVerifiers.map((verifier) =>
      verifier.credentialId === oldCredential.credentialId ? { ...verifier, revokedAt } : verifier,
    ),
    issued.verifier,
  ];
  const revocations = [
    ...stores.revocationStore.revocations,
    revocation("credential", oldCredential.credentialId, revokedAt, "credential rotation"),
    ...oldCredential.verifierIds.map((verifierId) =>
      revocation("tokenVerifier", verifierId, revokedAt, "credential rotation"),
    ),
  ];

  await Promise.all([
    writeCredentialStore(
      input.appDataDir,
      { credentials: [...credentials, issued.credential] },
      vaultRoots,
    ),
    writeTokenVerifierStore(input.appDataDir, { tokenVerifiers }, vaultRoots),
    writeBrowserSessionStore(input.appDataDir, stores.browserSessionStore, vaultRoots),
    writeRevocationStore(input.appDataDir, { revocations }, vaultRoots),
  ]);
  await auditCredentialLifecycleEvent(input.appDataDir, vaultRoots, {
    kind: "credential.rotated",
    result: "accepted",
    reasonCode: "credential-rotated",
    credentialId: oldCredential.credentialId,
    metadata: { replacementCredentialId: issued.credential.credentialId },
  });

  const latest = await readStores(input.appDataDir, vaultRoots);
  const summaries = summarizeCredentials(latest, now);
  const oldSummary = summaries.find(
    (credential) => credential.credentialId === oldCredential.credentialId,
  );
  const newSummary = summaries.find(
    (credential) => credential.credentialId === issued.credential.credentialId,
  );
  if (!oldSummary || !newSummary) throw httpError(500, "Credential rotation failed.");
  return {
    oldCredential: oldSummary,
    credential: newSummary,
    bearerToken: issued.bearerToken,
    tokenType: "Bearer",
  };
}

export async function auditCredentialLifecycleEvent(
  appDataDir: string,
  vaultRoots: readonly string[],
  input: {
    kind: AuthAuditEventKind;
    result: AuthAuditEvent["result"];
    reasonCode: string;
    credentialId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const event: AuthAuditEvent = {
    eventId: `evt-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    kind: input.kind,
    result: input.result,
    reasonCode: input.reasonCode,
    actor: { actorKind: "localOperator" },
    credentialId: input.credentialId,
    operation: "credentialLifecycle",
    metadata: input.metadata,
  };
  const auditEventsPath = resolveAuthStoragePaths(appDataDir, vaultRoots).auditEvents;
  await appendAuthAuditEvent(auditEventsPath, event).catch(() => undefined);
}

function getLifecycleStatusFromStores(stores: Stores, now: Date): CredentialLifecycleStatus {
  const summaries = summarizeCredentials(stores, now);
  const activeCredentialCount = summaries.filter((item) => item.status === "active").length;
  return {
    storeAvailable: true,
    activeCredentialCount,
    revokedCredentialCount: summaries.filter((item) => item.status === "revoked").length,
    expiredCredentialCount: summaries.filter((item) => item.status === "expired").length,
    totalCredentialCount: summaries.length,
    bootstrapAvailable: activeCredentialCount === 0,
  };
}

async function readStores(appDataDir: string, vaultRoots: readonly string[]): Promise<Stores> {
  const [credentialStore, tokenVerifierStore, browserSessionStore, revocationStore] =
    await Promise.all([
      readCredentialStore(appDataDir, vaultRoots),
      readTokenVerifierStore(appDataDir, vaultRoots),
      readBrowserSessionStore(appDataDir, vaultRoots),
      readRevocationStore(appDataDir, vaultRoots),
    ]);
  return { credentialStore, tokenVerifierStore, browserSessionStore, revocationStore };
}

async function issueCredential(input: {
  appDataDir: string;
  vaultRoots: readonly string[];
  stores: Stores;
  request: CredentialRequest;
  now: Date;
  reasonCode: string;
  auditKind: AuthAuditEventKind;
}): Promise<CredentialIssueResult> {
  const issued = buildCredential(input.request, input.now);
  await Promise.all([
    writeCredentialStore(
      input.appDataDir,
      { credentials: [...input.stores.credentialStore.credentials, issued.credential] },
      input.vaultRoots,
    ),
    writeTokenVerifierStore(
      input.appDataDir,
      { tokenVerifiers: [...input.stores.tokenVerifierStore.tokenVerifiers, issued.verifier] },
      input.vaultRoots,
    ),
    writeBrowserSessionStore(input.appDataDir, input.stores.browserSessionStore, input.vaultRoots),
    writeRevocationStore(input.appDataDir, input.stores.revocationStore, input.vaultRoots),
  ]);
  await auditCredentialLifecycleEvent(input.appDataDir, input.vaultRoots, {
    kind: input.auditKind,
    result: "accepted",
    reasonCode: input.reasonCode,
    credentialId: issued.credential.credentialId,
  });
  return {
    credential: summarizeCredential(
      issued.credential,
      {
        ...input.stores,
        tokenVerifierStore: {
          tokenVerifiers: [...input.stores.tokenVerifierStore.tokenVerifiers, issued.verifier],
        },
      },
      input.now,
    ),
    bearerToken: issued.bearerToken,
    tokenType: "Bearer",
  };
}

function buildCredential(
  request: CredentialRequest,
  now: Date,
): {
  credential: CredentialMetadata;
  verifier: TokenVerifierMetadataStore["tokenVerifiers"][number];
  bearerToken: string;
} {
  const credentialId = `cred-${crypto.randomUUID()}`;
  const verifierId = `verifier-${crypto.randomUUID()}`;
  const bearerToken = `arepo_${crypto.randomBytes(32).toString("base64url")}`;
  const createdAt = now.toISOString();
  const credential: CredentialMetadata = {
    credentialId,
    actorKind: "apiToken",
    label: request.label,
    nodePermissions: request.nodePermissions,
    vaultGrants: request.vaultGrants,
    createdAt,
    expiresAt: request.expiresAt,
    verifierIds: [verifierId],
    sessionIds: [],
    auditRefs: [],
  };
  return {
    credential,
    verifier: createTokenVerifierMetadata({
      tokenMaterial: bearerToken,
      credentialId,
      verifierId,
      createdAt,
      expiresAt: request.expiresAt,
    }),
    bearerToken,
  };
}

function parseCredentialRequest(
  body: Record<string, unknown>,
  vaults: readonly VaultInfo[],
): CredentialRequest {
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) throw httpError(400, "Credential label must be a non-empty string.");
  const expiresAt = parseOptionalFutureTimestamp(body.expiresAt);
  const nodePermissions = parsePermissions(body.nodePermissions, nodeAdminPermissions);
  const vaultGrants = parseVaultGrants(body.vaultGrants, vaults);
  return { label, expiresAt, nodePermissions, vaultGrants };
}

function parseOptionalFutureTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw httpError(400, "expiresAt must be a valid timestamp string.");
  }
  return new Date(value).toISOString();
}

function parsePermissions(
  value: unknown,
  fallback: readonly RoutePermission[],
): readonly RoutePermission[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) throw httpError(400, "permissions must be an array.");
  const permissions = value.map((item) => {
    if (!isRoutePermission(item)) throw httpError(400, `Unsupported permission "${String(item)}".`);
    return item;
  });
  return Array.from(new Set(permissions));
}

function parseVaultGrants(
  value: unknown,
  vaults: readonly VaultInfo[],
): readonly VaultScopedGrant[] {
  if (value === undefined) {
    return vaults.map((vault) => ({ vaultId: vault.id, permissions: vaultAdminPermissions }));
  }
  if (!Array.isArray(value)) throw httpError(400, "vaultGrants must be an array.");
  return value.map((grant) => {
    if (!grant || typeof grant !== "object" || Array.isArray(grant)) {
      throw httpError(400, "vaultGrants entries must be objects.");
    }
    const candidate = grant as Record<string, unknown>;
    if (typeof candidate.vaultId !== "string" || !candidate.vaultId.trim()) {
      throw httpError(400, "vaultGrants entries require vaultId.");
    }
    return {
      vaultId: candidate.vaultId,
      permissions: parsePermissions(candidate.permissions, []),
    };
  });
}

function summarizeCredentials(stores: Stores, now: Date): SafeCredentialSummary[] {
  return stores.credentialStore.credentials.map((credential) =>
    summarizeCredential(credential, stores, now),
  );
}

function summarizeCredential(
  credential: CredentialMetadata,
  stores: Stores,
  now: Date,
): SafeCredentialSummary {
  return {
    credentialId: credential.credentialId,
    label: credential.label,
    actorKind: credential.actorKind,
    createdAt: credential.createdAt,
    expiresAt: credential.expiresAt,
    lastUsedAt: credential.lastUsedAt,
    revokedAt: credential.revokedAt,
    nodePermissions: credential.nodePermissions,
    vaultGrants: credential.vaultGrants,
    status: credentialStatus(credential, stores.revocationStore, now),
    verifierCount: credential.verifierIds.length,
    sessionCount: credential.sessionIds.length,
  };
}

function credentialStatus(
  credential: CredentialMetadata,
  revocationStore: RevocationMetadataStore,
  now: Date,
): SafeCredentialStatus {
  if (isCredentialRevoked(credential, revocationStore)) return "revoked";
  if (credential.expiresAt && Date.parse(credential.expiresAt) <= now.getTime()) return "expired";
  return "active";
}

function isCredentialRevoked(
  credential: CredentialMetadata,
  revocationStore: RevocationMetadataStore,
): boolean {
  return (
    Boolean(credential.revokedAt) ||
    revocationStore.revocations.some(
      (item) => item.targetKind === "credential" && item.targetId === credential.credentialId,
    )
  );
}

function revocation(
  targetKind: RevocationMetadata["targetKind"],
  targetId: string,
  revokedAt: string,
  reason = "credential lifecycle operation",
): RevocationMetadata {
  return {
    revocationId: `revoke-${crypto.randomUUID()}`,
    targetKind,
    targetId,
    revokedAt,
    reason,
  };
}

function isRoutePermission(value: unknown): value is RoutePermission {
  return (
    typeof value === "string" && (ROUTE_PERMISSION_VOCABULARY as readonly string[]).includes(value)
  );
}

function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  error.code = status === 404 ? "ENOENT" : status === 409 ? "CONFLICT" : "EINVAL";
  return error;
}
