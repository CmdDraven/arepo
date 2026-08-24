export type VaultLoadFailureScope = "whole-vault" | "source-content";

export function globalErrorForLoadFailure(
  scope: VaultLoadFailureScope,
  error: unknown,
): string | null {
  if (scope === "source-content") return null;
  return error instanceof Error ? error.message : "Unknown error";
}
