import fs from "node:fs/promises";
import {
  AUTH_STORAGE_OWNER_ONLY_DIRECTORY_MODE,
  AUTH_STORAGE_OWNER_ONLY_FILE_MODE,
  readBrowserSessionStore,
  readCredentialStore,
  readRevocationStore,
  readTokenVerifierStore,
  resolveAuthStoragePaths,
  type AuthStoragePaths,
} from "./credentialStore.js";
import type { BackendRuntimeOptions } from "./nodeRuntime.js";
import type {
  AuthConfig,
  ProtectedModeStartupAssessment,
  ProtectedModeStoreDiagnostic,
  ProtectedModeStoreName,
} from "./types.js";

type AssessmentInput = {
  auth: AuthConfig;
  appDataDir: string;
  vaultRoots?: readonly string[];
  runtime: Pick<BackendRuntimeOptions, "nonLocalWarning">;
};

type RequiredStore = {
  name: ProtectedModeStoreName;
  pathKey: keyof Pick<
    AuthStoragePaths,
    "credentials" | "tokenVerifiers" | "sessions" | "revocations"
  >;
  read: (appDataDir: string, vaultRoots?: readonly string[]) => Promise<unknown>;
};

const requiredStores: readonly RequiredStore[] = [
  { name: "credentials", pathKey: "credentials", read: readCredentialStore },
  { name: "tokenVerifiers", pathKey: "tokenVerifiers", read: readTokenVerifierStore },
  { name: "sessions", pathKey: "sessions", read: readBrowserSessionStore },
  { name: "revocations", pathKey: "revocations", read: readRevocationStore },
];

export async function assessProtectedModeStartup(
  input: AssessmentInput,
): Promise<ProtectedModeStartupAssessment> {
  const requestedAuthMode = input.auth.requestedMode ?? input.auth.mode;
  const protectedModeRequested = requestedAuthMode === "protected";
  const unsafeStorePaths: string[] = [];
  const missingRequiredStores: ProtectedModeStoreDiagnostic[] = [];
  const corruptStores: ProtectedModeStoreDiagnostic[] = [];
  const permissionWarnings: string[] = [];

  let paths: AuthStoragePaths | undefined;
  try {
    paths = resolveAuthStoragePaths(input.appDataDir, input.vaultRoots ?? []);
  } catch (error) {
    unsafeStorePaths.push(error instanceof Error ? error.message : "Auth storage path is unsafe.");
  }

  if (paths) {
    permissionWarnings.push(...(await permissionWarningsForPaths(paths)));
  }

  if (protectedModeRequested && paths) {
    for (const store of requiredStores) {
      const file = paths[store.pathKey];
      if (!(await fileExists(file))) {
        missingRequiredStores.push({
          store: store.name,
          path: file,
          error: "Required protected-mode auth store is missing.",
        });
        continue;
      }

      try {
        await store.read(input.appDataDir, input.vaultRoots ?? []);
      } catch (error) {
        corruptStores.push({
          store: store.name,
          path: file,
          error: error instanceof Error ? error.message : "Auth store validation failed.",
          quarantineCandidate: `${file}.corrupt`,
        });
      }
    }
  }
  const protectedModeAvailable =
    protectedModeRequested &&
    missingRequiredStores.length === 0 &&
    corruptStores.length === 0 &&
    unsafeStorePaths.length === 0;

  return {
    requestedAuthMode,
    operationalAuthMode: input.auth.mode,
    protectedModeAvailable,
    protectedModeMayStart: protectedModeAvailable,
    missingRequiredStores,
    corruptStores,
    unsafeStorePaths,
    permissionWarnings,
    nonLocalBindWithDisabledAuth: Boolean(
      input.runtime.nonLocalWarning && input.auth.mode === "disabled",
    ),
    enforcementActive: input.auth.mode === "protected" && protectedModeAvailable,
    credentialVerificationActive: input.auth.mode === "protected" && protectedModeAvailable,
    auditWiringActive: input.auth.mode === "protected" && protectedModeAvailable,
    revocationChecksActive: input.auth.mode === "protected" && protectedModeAvailable,
    csrfOriginEnforcementActive: false,
    networkExposureSafe: false,
  };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function permissionWarningsForPaths(paths: AuthStoragePaths): Promise<string[]> {
  if (process.platform === "win32") return [];
  const warnings: string[] = [];
  await addPermissionWarning(paths.authDir, AUTH_STORAGE_OWNER_ONLY_DIRECTORY_MODE, warnings);
  for (const file of [paths.credentials, paths.tokenVerifiers, paths.sessions, paths.revocations]) {
    await addPermissionWarning(file, AUTH_STORAGE_OWNER_ONLY_FILE_MODE, warnings);
  }
  return warnings;
}

async function addPermissionWarning(
  targetPath: string,
  expectedMode: number,
  warnings: string[],
): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    warnings.push(`Could not inspect auth store permissions for ${targetPath}.`);
    return;
  }

  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    warnings.push(
      `Auth store path ${targetPath} has permissions ${mode.toString(
        8,
      )}; expected owner-only ${expectedMode.toString(8)} where supported.`,
    );
  }
}
