import type { AuthConfig, AuthPosture } from "./types.js";
import { PROTECTED_MODE_UNAVAILABLE_REASON } from "./types.js";

export const DEFAULT_BACKEND_PORT = 8734;
export const DEFAULT_BACKEND_HOST = "127.0.0.1";
export const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:8733", "http://127.0.0.1:8733"];

export type BackendRuntimeOptions = {
  host: string;
  port: number;
  allowedOrigins: string[];
  nonLocalWarning?: string;
};

export function resolveBackendRuntimeOptions(
  env: NodeJS.ProcessEnv = process.env,
): BackendRuntimeOptions {
  const host = resolveBackendHost(env);
  const port = resolveBackendPort(env);
  return {
    host,
    port,
    allowedOrigins: configuredAllowedOrigins(env),
    nonLocalWarning: isLocalBindHost(host) ? undefined : nonLocalBindWarning(host),
  };
}

export function resolveBackendHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.AREPO_HOST?.trim() || DEFAULT_BACKEND_HOST;
}

export function resolveBackendPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AREPO_PORT?.trim();
  if (!raw) return DEFAULT_BACKEND_PORT;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid AREPO_PORT "${raw}": expected a TCP port number`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid AREPO_PORT "${raw}": expected a TCP port from 1 to 65535`);
  }
  return port;
}

export function configuredAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.AREPO_ALLOWED_ORIGINS;
  const configured = raw
    ? raw
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];
  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]));
}

export function isLocalBindHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function nonLocalBindWarning(host: string): string {
  return (
    `WARNING: AREPO backend binding to non-local address "${host}". ` +
    "V1 has no authentication; do not expose this server to untrusted networks."
  );
}

export function resolveAuthPosture(
  auth: AuthConfig,
  runtime: Pick<BackendRuntimeOptions, "nonLocalWarning">,
): AuthPosture {
  const requestedMode = auth.requestedMode ?? auth.mode;
  const protectedModeRequested = requestedMode === "protected";
  const protectedModeEnabled = auth.mode === "protected";
  const unavailableReason =
    auth.protectedModeUnavailableReason ?? PROTECTED_MODE_UNAVAILABLE_REASON;
  const disabledWarning = runtime.nonLocalWarning
    ? "Authentication is disabled and not enforced; non-local binding is unsafe in V1."
    : "Authentication is disabled and not enforced in V1 local-only mode.";
  const posture: AuthPosture = {
    mode: auth.mode,
    requestedMode,
    enabled: protectedModeEnabled,
    enforcement: protectedModeEnabled ? "protected" : "none",
    protectedModeAvailable: protectedModeEnabled,
    protectedModeRequested,
    warning: protectedModeEnabled
      ? runtime.nonLocalWarning
        ? "Protected mode is enabled, but network exposure is still not considered safe."
        : "Protected mode is enabled for local bearer-token enforcement."
      : protectedModeRequested
        ? `${unavailableReason}; authentication remains disabled and unenforced.`
        : disabledWarning,
  };
  if (protectedModeRequested && !protectedModeEnabled) {
    posture.error = unavailableReason;
  }
  return posture;
}
