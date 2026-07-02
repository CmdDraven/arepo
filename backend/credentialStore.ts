import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ROUTE_PERMISSION_VOCABULARY, type RoutePermission } from "./routePermissions.js";

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
  "recoverySecret",
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

export type CredentialMetadataStore = {
  credentials: readonly CredentialMetadata[];
};

export type TokenVerifierMetadataStore = {
  tokenVerifiers: readonly TokenVerifierMetadata[];
};

export type BrowserSessionMetadataStore = {
  sessions: readonly BrowserSessionMetadata[];
};

export type RevocationMetadataStore = {
  revocations: readonly RevocationMetadata[];
};

export const EMPTY_CREDENTIAL_STORE: CredentialMetadataStore = { credentials: [] };
export const EMPTY_TOKEN_VERIFIER_STORE: TokenVerifierMetadataStore = { tokenVerifiers: [] };
export const EMPTY_BROWSER_SESSION_STORE: BrowserSessionMetadataStore = { sessions: [] };
export const EMPTY_REVOCATION_STORE: RevocationMetadataStore = { revocations: [] };

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

export async function readCredentialStore(
  appDataDir: string,
  vaultRoots: readonly string[] = [],
): Promise<CredentialMetadataStore> {
  const paths = resolveAuthStoragePaths(appDataDir, vaultRoots);
  return readAuthJsonStore(paths.credentials, EMPTY_CREDENTIAL_STORE, assertCredentialStore);
}

export async function writeCredentialStore(
  appDataDir: string,
  store: CredentialMetadataStore,
  vaultRoots: readonly string[] = [],
): Promise<void> {
  const paths = resolveAuthStoragePaths(appDataDir, vaultRoots);
  assertCredentialStore(store);
  await atomicWriteAuthJson(paths.credentials, store);
}

export async function readTokenVerifierStore(
  appDataDir: string,
  vaultRoots: readonly string[] = [],
): Promise<TokenVerifierMetadataStore> {
  const paths = resolveAuthStoragePaths(appDataDir, vaultRoots);
  return readAuthJsonStore(
    paths.tokenVerifiers,
    EMPTY_TOKEN_VERIFIER_STORE,
    assertTokenVerifierStore,
  );
}

export async function writeTokenVerifierStore(
  appDataDir: string,
  store: TokenVerifierMetadataStore,
  vaultRoots: readonly string[] = [],
): Promise<void> {
  const paths = resolveAuthStoragePaths(appDataDir, vaultRoots);
  assertTokenVerifierStore(store);
  await atomicWriteAuthJson(paths.tokenVerifiers, store);
}

export async function readBrowserSessionStore(
  appDataDir: string,
  vaultRoots: readonly string[] = [],
): Promise<BrowserSessionMetadataStore> {
  const paths = resolveAuthStoragePaths(appDataDir, vaultRoots);
  return readAuthJsonStore(paths.sessions, EMPTY_BROWSER_SESSION_STORE, assertBrowserSessionStore);
}

export async function writeBrowserSessionStore(
  appDataDir: string,
  store: BrowserSessionMetadataStore,
  vaultRoots: readonly string[] = [],
): Promise<void> {
  const paths = resolveAuthStoragePaths(appDataDir, vaultRoots);
  assertBrowserSessionStore(store);
  await atomicWriteAuthJson(paths.sessions, store);
}

export async function readRevocationStore(
  appDataDir: string,
  vaultRoots: readonly string[] = [],
): Promise<RevocationMetadataStore> {
  const paths = resolveAuthStoragePaths(appDataDir, vaultRoots);
  return readAuthJsonStore(paths.revocations, EMPTY_REVOCATION_STORE, assertRevocationStore);
}

export async function writeRevocationStore(
  appDataDir: string,
  store: RevocationMetadataStore,
  vaultRoots: readonly string[] = [],
): Promise<void> {
  const paths = resolveAuthStoragePaths(appDataDir, vaultRoots);
  assertRevocationStore(store);
  await atomicWriteAuthJson(paths.revocations, store);
}

export function validateCredentialStore(value: unknown): AuthStorageValidation {
  const errors = validateStoreObject(value, "credentials");
  if (errors.length === 0) {
    (value as CredentialMetadataStore).credentials.forEach((credential, index) =>
      validateCredentialMetadata(credential, `credentials[${index}]`, errors),
    );
  }
  return validationResult(errors);
}

export function assertCredentialStore(value: unknown): asserts value is CredentialMetadataStore {
  assertValidation(validateCredentialStore(value), "credential store");
}

export function validateTokenVerifierStore(value: unknown): AuthStorageValidation {
  const errors = validateStoreObject(value, "tokenVerifiers");
  if (errors.length === 0) {
    (value as TokenVerifierMetadataStore).tokenVerifiers.forEach((verifier, index) =>
      validateTokenVerifierMetadata(verifier, `tokenVerifiers[${index}]`, errors),
    );
  }
  return validationResult(errors);
}

export function assertTokenVerifierStore(
  value: unknown,
): asserts value is TokenVerifierMetadataStore {
  assertValidation(validateTokenVerifierStore(value), "token verifier store");
}

export function validateBrowserSessionStore(value: unknown): AuthStorageValidation {
  const errors = validateStoreObject(value, "sessions");
  if (errors.length === 0) {
    (value as BrowserSessionMetadataStore).sessions.forEach((session, index) =>
      validateBrowserSessionMetadata(session, `sessions[${index}]`, errors),
    );
  }
  return validationResult(errors);
}

export function assertBrowserSessionStore(
  value: unknown,
): asserts value is BrowserSessionMetadataStore {
  assertValidation(validateBrowserSessionStore(value), "browser session store");
}

export function validateRevocationStore(value: unknown): AuthStorageValidation {
  const errors = validateStoreObject(value, "revocations");
  if (errors.length === 0) {
    (value as RevocationMetadataStore).revocations.forEach((revocation, index) =>
      validateRevocationMetadata(revocation, `revocations[${index}]`, errors),
    );
  }
  return validationResult(errors);
}

export function assertRevocationStore(value: unknown): asserts value is RevocationMetadataStore {
  assertValidation(validateRevocationStore(value), "revocation store");
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

async function readAuthJsonStore<T>(
  file: string,
  emptyStore: T,
  assertStore: (value: unknown) => asserts value is T,
): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(emptyStore);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Corrupt AREPO auth store at ${file}: ${
        error instanceof Error ? error.message : "invalid JSON"
      }`,
    );
  }

  try {
    assertStore(parsed);
  } catch (error) {
    throw new Error(
      `Invalid AREPO auth store at ${file}: ${
        error instanceof Error ? error.message : "validation failed"
      }`,
    );
  }
  return parsed;
}

async function atomicWriteAuthJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), {
    recursive: true,
    mode: AUTH_STORAGE_OWNER_ONLY_DIRECTORY_MODE,
  });

  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`,
  );
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await fs.open(tmp, "wx", AUTH_STORAGE_OWNER_ONLY_FILE_MODE);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tmp, file);
    await syncDirectory(path.dirname(file));
  } catch (error) {
    await fs.unlink(tmp).catch((unlinkError: NodeJS.ErrnoException) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}

async function syncDirectory(dir: string): Promise<void> {
  if (process.platform === "win32") return;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch {
    // Directory fsync is best-effort across platforms and filesystems.
  } finally {
    await handle?.close();
  }
}

function validateStoreObject(value: unknown, arrayKey: string): string[] {
  const secretErrors: string[] = [];
  visitConfigValue(value, [], secretErrors);
  const errors = secretErrors.map((secretPath) => `secret-like field ${secretPath} is not allowed`);
  if (!isRecord(value)) {
    errors.push("store must be an object");
    return errors;
  }
  if (!Array.isArray(value[arrayKey])) {
    errors.push(`${arrayKey} must be an array`);
  }
  return errors;
}

function validateCredentialMetadata(value: unknown, base: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${base} must be an object`);
    return;
  }
  requireStableId(value.credentialId, `${base}.credentialId`, errors);
  requireKnown(value.actorKind, knownCredentialActorKinds, `${base}.actorKind`, errors);
  requireNonEmptyString(value.label, `${base}.label`, errors);
  validatePermissionArray(value.nodePermissions, `${base}.nodePermissions`, errors);
  if (!Array.isArray(value.vaultGrants)) {
    errors.push(`${base}.vaultGrants must be an array`);
  } else {
    value.vaultGrants.forEach((grant, index) =>
      validateVaultGrant(grant, `${base}.vaultGrants[${index}]`, errors),
    );
  }
  requireTimestamp(value.createdAt, `${base}.createdAt`, errors);
  optionalTimestamp(value.expiresAt, `${base}.expiresAt`, errors);
  optionalTimestamp(value.lastUsedAt, `${base}.lastUsedAt`, errors);
  optionalTimestamp(value.revokedAt, `${base}.revokedAt`, errors);
  validateStableIdArray(value.verifierIds, `${base}.verifierIds`, errors);
  validateStableIdArray(value.sessionIds, `${base}.sessionIds`, errors);
  validateAuditRefs(value.auditRefs, `${base}.auditRefs`, errors);
}

function validateTokenVerifierMetadata(value: unknown, base: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${base} must be an object`);
    return;
  }
  requireStableId(value.verifierId, `${base}.verifierId`, errors);
  requireStableId(value.credentialId, `${base}.credentialId`, errors);
  requireStableId(value.lookupId, `${base}.lookupId`, errors);
  requireNonEmptyString(value.displayPrefix, `${base}.displayPrefix`, errors);
  requireStableId(value.saltId, `${base}.saltId`, errors);
  requireKnown(value.hashAlgorithm, knownHashAlgorithms, `${base}.hashAlgorithm`, errors);
  if (!isRecord(value.hashParameters)) errors.push(`${base}.hashParameters must be an object`);
  requireNonEmptyString(value.verifierHash, `${base}.verifierHash`, errors);
  requireTimestamp(value.createdAt, `${base}.createdAt`, errors);
  optionalTimestamp(value.expiresAt, `${base}.expiresAt`, errors);
  optionalTimestamp(value.lastUsedAt, `${base}.lastUsedAt`, errors);
  optionalTimestamp(value.revokedAt, `${base}.revokedAt`, errors);
}

function validateBrowserSessionMetadata(value: unknown, base: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${base} must be an object`);
    return;
  }
  requireStableId(value.sessionId, `${base}.sessionId`, errors);
  requireStableId(value.credentialId, `${base}.credentialId`, errors);
  requireStableId(value.verifierId, `${base}.verifierId`, errors);
  requireTimestamp(value.createdAt, `${base}.createdAt`, errors);
  requireTimestamp(value.expiresAt, `${base}.expiresAt`, errors);
  optionalTimestamp(value.renewedAt, `${base}.renewedAt`, errors);
  optionalTimestamp(value.lastUsedAt, `${base}.lastUsedAt`, errors);
  optionalTimestamp(value.loggedOutAt, `${base}.loggedOutAt`, errors);
  optionalTimestamp(value.revokedAt, `${base}.revokedAt`, errors);
  requireKnown(value.sameSite, knownSameSiteValues, `${base}.sameSite`, errors);
  optionalStableId(value.csrfBindingId, `${base}.csrfBindingId`, errors);
}

function validateRevocationMetadata(value: unknown, base: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${base} must be an object`);
    return;
  }
  requireStableId(value.revocationId, `${base}.revocationId`, errors);
  requireKnown(value.targetKind, knownRevocationTargetKinds, `${base}.targetKind`, errors);
  requireStableId(value.targetId, `${base}.targetId`, errors);
  requireTimestamp(value.revokedAt, `${base}.revokedAt`, errors);
  requireNonEmptyString(value.reason, `${base}.reason`, errors);
  if (value.auditRef !== undefined) validateAuditRef(value.auditRef, `${base}.auditRef`, errors);
}

function validateVaultGrant(value: unknown, base: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${base} must be an object`);
    return;
  }
  requireStableId(value.vaultId, `${base}.vaultId`, errors);
  validatePermissionArray(value.permissions, `${base}.permissions`, errors);
}

function validateAuditRefs(value: unknown, base: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${base} must be an array`);
    return;
  }
  value.forEach((auditRef, index) => validateAuditRef(auditRef, `${base}[${index}]`, errors));
}

function validateAuditRef(value: unknown, base: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${base} must be an object`);
    return;
  }
  requireStableId(value.eventId, `${base}.eventId`, errors);
  requireTimestamp(value.eventAt, `${base}.eventAt`, errors);
  requireNonEmptyString(value.eventType, `${base}.eventType`, errors);
}

function validatePermissionArray(value: unknown, base: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${base} must be an array`);
    return;
  }
  value.forEach((permission, index) =>
    requireKnown(permission, ROUTE_PERMISSION_VOCABULARY, `${base}[${index}]`, errors),
  );
}

function validateStableIdArray(value: unknown, base: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${base} must be an array`);
    return;
  }
  value.forEach((id, index) => requireStableId(id, `${base}[${index}]`, errors));
}

function requireStableId(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._:-]+$/.test(value)) {
    errors.push(`${field} must be a stable non-empty id string`);
  }
}

function optionalStableId(value: unknown, field: string, errors: string[]): void {
  if (value !== undefined) requireStableId(value, field, errors);
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${field} must be a non-empty string`);
  }
}

function requireTimestamp(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(`${field} must be a valid timestamp string`);
  }
}

function optionalTimestamp(value: unknown, field: string, errors: string[]): void {
  if (value !== undefined) requireTimestamp(value, field, errors);
}

function requireKnown<T extends string>(
  value: unknown,
  knownValues: readonly T[],
  field: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !(knownValues as readonly string[]).includes(value)) {
    errors.push(`${field} has unsupported value "${String(value)}"`);
  }
}

function validationResult(errors: string[]): AuthStorageValidation {
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

function assertValidation(result: AuthStorageValidation, label: string): void {
  if (!result.ok) {
    throw new Error(`Invalid ${label}: ${result.errors.join(", ")}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const knownCredentialActorKinds: readonly CredentialActorKind[] = [
  "browserSession",
  "apiToken",
  "localPairing",
  "futureNode",
  "readOnlyArchive",
];

const knownHashAlgorithms: readonly TokenVerifierMetadata["hashAlgorithm"][] = [
  "sha256",
  "sha512",
  "argon2id",
];

const knownSameSiteValues: readonly BrowserSessionMetadata["sameSite"][] = ["strict", "lax"];

const knownRevocationTargetKinds: readonly RevocationTargetKind[] = [
  "credential",
  "tokenVerifier",
  "browserSession",
  "nodeSecretGeneration",
  "emergencyLocalOnlyReset",
];
