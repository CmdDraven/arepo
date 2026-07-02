import path from "node:path";
import type { RoutePermission } from "./routePermissions.js";

export const AUTH_STORAGE_DIRECTORY = "auth";
export const AUTH_STORAGE_OWNER_ONLY_FILE_MODE = 0o600;
export const AUTH_STORAGE_OWNER_ONLY_DIRECTORY_MODE = 0o700;
export const AUTH_STORAGE_REQUIRES_ATOMIC_WRITES = true;
export const AUTH_STORAGE_NETWORK_EXPOSURE_SAFE = false;

export const AUTH_SECRET_CONFIG_KEYS = [
  "token",
  "bearerToken",
  "pairingSecret",
  "privateKey",
  "sessionSecret",
  "passwordHash",
  "tokenVerifier",
] as const;

export type AuthSecretConfigKey = (typeof AUTH_SECRET_CONFIG_KEYS)[number];

export type CredentialActorKind =
  "browserSession" | "apiToken" | "localPairing" | "futureNode" | "readOnlyArchive";

export type VaultScopedGrant = {
  vaultId: string;
  permissions: readonly RoutePermission[];
};

export type CredentialMetadata = {
  credentialId: string;
  actorKind: CredentialActorKind;
  label: string;
  nodePermissions: readonly RoutePermission[];
  vaultGrants: readonly VaultScopedGrant[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  verifierIds: readonly string[];
  sessionIds: readonly string[];
  auditRefs: readonly AuditReferenceMetadata[];
};

export type TokenVerifierMetadata = {
  verifierId: string;
  credentialId: string;
  lookupId: string;
  displayPrefix: string;
  saltId: string;
  hashAlgorithm: "sha256" | "sha512" | "argon2id";
  hashParameters: Record<string, string | number | boolean>;
  verifierHash: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type BrowserSessionMetadata = {
  sessionId: string;
  credentialId: string;
  verifierId: string;
  createdAt: string;
  expiresAt: string;
  renewedAt?: string;
  lastUsedAt?: string;
  loggedOutAt?: string;
  revokedAt?: string;
  sameSite: "strict" | "lax";
  csrfBindingId?: string;
};

export type RevocationTargetKind =
  | "credential"
  | "tokenVerifier"
  | "browserSession"
  | "nodeSecretGeneration"
  | "emergencyLocalOnlyReset";

export type RevocationMetadata = {
  revocationId: string;
  targetKind: RevocationTargetKind;
  targetId: string;
  revokedAt: string;
  reason: string;
  auditRef?: AuditReferenceMetadata;
};

export type AuditReferenceMetadata = {
  eventId: string;
  eventAt: string;
  eventType: string;
};

export type NodeSecretMetadata = {
  secretId: string;
  generation: number;
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  storagePath: "auth/node-secret";
};

export type AuthStoragePaths = {
  authDir: string;
  credentials: string;
  tokenVerifiers: string;
  sessions: string;
  revocations: string;
  nodeSecret: string;
  auditDir: string;
  auditEvents: string;
};

export type ValidationResult = {
  ok: true;
};

export type ValidationFailure = {
  ok: false;
  errors: string[];
};

export type AuthStorageValidation = ValidationResult | ValidationFailure;

export function resolveAuthStoragePaths(
  appDataDir: string,
  vaultRoots: readonly string[] = [],
): AuthStoragePaths {
  const root = path.resolve(appDataDir);
  const authDir = path.join(root, AUTH_STORAGE_DIRECTORY);
  const paths: AuthStoragePaths = {
    authDir,
    credentials: path.join(authDir, "credentials.json"),
    tokenVerifiers: path.join(authDir, "token-verifiers.json"),
    sessions: path.join(authDir, "sessions.json"),
    revocations: path.join(authDir, "revocations.json"),
    nodeSecret: path.join(authDir, "node-secret"),
    auditDir: path.join(authDir, "audit"),
    auditEvents: path.join(authDir, "audit", "events.jsonl"),
  };
  assertAuthStorageOutsideVaults(paths, vaultRoots);
  return paths;
}

export function assertAuthStorageOutsideVaults(
  authPaths: Pick<AuthStoragePaths, "authDir">,
  vaultRoots: readonly string[],
): void {
  for (const vaultRoot of vaultRoots) {
    if (isPathInside(path.resolve(vaultRoot), authPaths.authDir)) {
      throw new Error("AREPO auth storage must not be placed inside a Markdown vault root");
    }
  }
}

export function validateConfigShapeContainsNoAuthSecrets(value: unknown): AuthStorageValidation {
  const errors: string[] = [];
  visitConfigValue(value, [], errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function assertConfigShapeContainsNoAuthSecrets(value: unknown): void {
  const result = validateConfigShapeContainsNoAuthSecrets(value);
  if (!result.ok) {
    throw new Error(`Config-shaped data contains auth secret fields: ${result.errors.join(", ")}`);
  }
}

export function validateAuthMaterialPathOutsideVaults(
  authMaterialPath: string,
  vaultRoots: readonly string[],
): AuthStorageValidation {
  const resolved = path.resolve(authMaterialPath);
  const errors = vaultRoots
    .map((vaultRoot) => path.resolve(vaultRoot))
    .filter((vaultRoot) => isPathInside(vaultRoot, resolved))
    .map((vaultRoot) => `Auth material path ${resolved} is inside Markdown vault ${vaultRoot}`);
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

function visitConfigValue(value: unknown, pathParts: string[], errors: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitConfigValue(item, [...pathParts, String(index)], errors));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (isAuthSecretConfigKey(key)) {
      errors.push(childPath.join("."));
    }
    visitConfigValue(child, childPath, errors);
  }
}

function isAuthSecretConfigKey(key: string): key is AuthSecretConfigKey {
  return (AUTH_SECRET_CONFIG_KEYS as readonly string[]).includes(key);
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
