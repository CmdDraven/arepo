import type { VaultIndexScope } from "./types.js";
import { PublicApiError } from "./publicApiError.js";

export const DEFAULT_VAULT_INDEX_SCOPE: VaultIndexScope = {
  markdown: {
    minDepth: 0,
    maxDepth: null,
  },
};

export function normalizeVaultIndexScope(scope: unknown): VaultIndexScope {
  if (scope === undefined) return defaultVaultIndexScope();
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return scope as VaultIndexScope;
  }
  const markdown = (scope as { markdown?: unknown }).markdown;
  if (!markdown || typeof markdown !== "object" || Array.isArray(markdown)) {
    return { ...(scope as VaultIndexScope), markdown: undefined as never };
  }
  const raw = markdown as { minDepth?: unknown; maxDepth?: unknown };
  return {
    markdown: {
      minDepth: raw.minDepth as number,
      maxDepth: raw.maxDepth as number | null,
    },
  };
}

export function defaultVaultIndexScope(): VaultIndexScope {
  return {
    markdown: {
      minDepth: DEFAULT_VAULT_INDEX_SCOPE.markdown.minDepth,
      maxDepth: DEFAULT_VAULT_INDEX_SCOPE.markdown.maxDepth,
    },
  };
}

export function validateVaultIndexScope(scope: VaultIndexScope, context: string): void {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw invalidIndexScope(context, "vaultIndexScope must be an object");
  }
  const markdown = scope.markdown;
  if (!markdown || typeof markdown !== "object" || Array.isArray(markdown)) {
    throw invalidIndexScope(context, "vaultIndexScope.markdown is required");
  }
  if (!Number.isInteger(markdown.minDepth) || markdown.minDepth < 0) {
    throw invalidIndexScope(context, "vaultIndexScope.markdown.minDepth must be an integer >= 0");
  }
  if (
    markdown.maxDepth !== null &&
    (!Number.isInteger(markdown.maxDepth) || markdown.maxDepth < markdown.minDepth)
  ) {
    throw invalidIndexScope(
      context,
      "vaultIndexScope.markdown.maxDepth must be null or an integer >= minDepth",
    );
  }
}

function invalidIndexScope(context: string, detail: string): PublicApiError {
  return new PublicApiError(400, `Invalid vault index scope: ${detail}`, {
    code: "invalid-index-scope",
    internalMessage: `${context}: ${detail}`,
  });
}

export function markdownDepthFromVaultRoot(vaultPath: string): number {
  const normalized = vaultPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  return Math.max(0, segments.length - 1);
}

export function markdownPathInScope(vaultPath: string, scope: VaultIndexScope): boolean {
  const depth = markdownDepthFromVaultRoot(vaultPath);
  const { minDepth, maxDepth } = scope.markdown;
  return depth >= minDepth && (maxDepth === null || depth <= maxDepth);
}

export function indexScopeSummary(scope: VaultIndexScope): string {
  const { minDepth, maxDepth } = scope.markdown;
  if (minDepth === 0 && maxDepth === null) return "All Markdown files";
  if (minDepth === 0 && maxDepth === 0) return "Root only";
  if (minDepth === 0 && maxDepth !== null) {
    return `Root through ${maxDepth} folder${maxDepth === 1 ? "" : "s"} deep`;
  }
  if (maxDepth === minDepth) {
    return `Only files exactly ${minDepth} folder${minDepth === 1 ? "" : "s"} deep`;
  }
  if (maxDepth === null) return `Files ${minDepth} or more folders deep`;
  return `Custom depth range: ${minDepth} through ${maxDepth}`;
}
