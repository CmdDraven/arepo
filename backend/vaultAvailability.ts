import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PublicApiError } from "./publicApiError.js";
import type { VaultAvailability, VaultAvailabilityReason, VaultInfo } from "./types.js";

export class VaultUnavailableError extends PublicApiError {
  readonly code = "VAULT_ROOT_UNAVAILABLE";
  readonly status = 503;

  constructor(readonly reason: VaultAvailabilityReason) {
    super(503, "Vault root is unavailable.", {
      code: "VAULT_ROOT_UNAVAILABLE",
      reason,
    });
    this.name = "VaultUnavailableError";
  }
}

export class VaultRootValidationError extends PublicApiError {
  readonly code = "INVALID_VAULT_ROOT";
  readonly status = 400;

  constructor(readonly reason: VaultAvailabilityReason | "invalid-root-path") {
    super(400, validationMessage(reason), {
      code: "INVALID_VAULT_ROOT",
      reason,
    });
    this.name = "VaultRootValidationError";
  }
}

export async function assessVaultAvailability(rootPath: string): Promise<VaultAvailability> {
  let stat;
  try {
    stat = await fs.stat(rootPath);
  } catch (error) {
    return {
      status: "unavailable",
      reason: missingPathError(error) ? "root-not-found" : "root-inaccessible",
    };
  }
  if (!stat.isDirectory()) {
    return { status: "unavailable", reason: "root-not-directory" };
  }
  try {
    await fs.access(rootPath, fsSync.constants.R_OK | fsSync.constants.X_OK);
    return { status: "available" };
  } catch {
    return { status: "unavailable", reason: "root-inaccessible" };
  }
}

export async function withVaultAvailability(vault: VaultInfo): Promise<VaultInfo> {
  return { ...vault, availability: await assessVaultAvailability(vault.rootPath) };
}

export async function requireAvailableVault(vault: VaultInfo): Promise<VaultInfo> {
  const availability = await assessVaultAvailability(vault.rootPath);
  if (availability.status === "unavailable") {
    throw new VaultUnavailableError(availability.reason);
  }
  return vault;
}

export async function validateVaultRoot(rootInput: unknown): Promise<string> {
  if (
    typeof rootInput !== "string" ||
    !rootInput.trim() ||
    rootInput.includes("\0") ||
    !path.isAbsolute(rootInput)
  ) {
    throw new VaultRootValidationError("invalid-root-path");
  }
  const rootPath = path.resolve(rootInput);
  const availability = await assessVaultAvailability(rootPath);
  if (availability.status === "unavailable") {
    throw new VaultRootValidationError(availability.reason);
  }
  return rootPath;
}

function missingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function validationMessage(reason: VaultAvailabilityReason | "invalid-root-path"): string {
  switch (reason) {
    case "root-not-found":
      return "Vault root was not found.";
    case "root-not-directory":
      return "Vault root must be a directory.";
    case "root-inaccessible":
      return "Vault root is not accessible.";
    default:
      return "Vault root path is invalid.";
  }
}
