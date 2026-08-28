import { addRelatedMetadataEntry } from "../src/lib/vault/frontmatter.js";
import { normalizeMarkdownFilePath } from "./path.js";
import { PublicApiError } from "./publicApiError.js";
import {
  clearRelatedNotesCurationDecision,
  requireKeptRelatedNotesCurationDecision,
} from "./relatedNotesCuration.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";
import { readVaultFile, writeVaultFile } from "./vaultFs.js";

const CURATION_CLEAR_DIAGNOSTIC =
  "The requested canonical relationship metadata is present, but its AREPO curation decision could not be cleared.";
const PARTIAL_WRITE_DIAGNOSTIC =
  "Relationship metadata was added to one note, but the other note could not be updated.";

export type RelationshipPromotionOwnership = "current" | "related" | "both";
export type RelationshipPromotionOwnerRole = "current" | "related";

export type RelationshipPromotionOwnerResult =
  | {
      role: RelationshipPromotionOwnerRole;
      ownerPath: string;
      targetPath: string;
      status: "promoted" | "already-present";
      file: Awaited<ReturnType<typeof writeVaultFile>>;
    }
  | {
      role: RelationshipPromotionOwnerRole;
      ownerPath: string;
      targetPath: string;
      status: "failed";
      error: string;
      code: string;
    };

export type RelationshipPromotionResult = {
  status: "complete" | "partial";
  ownership: RelationshipPromotionOwnership;
  currentPath: string;
  relatedPath: string;
  results: RelationshipPromotionOwnerResult[];
  diagnostic?: string;
  curationDiagnostic?: string;
};

type PromotionRequest = {
  ownership: RelationshipPromotionOwnership;
  currentPath: string;
  relatedPath: string;
  expectedHashes: { current: string; related: string };
};

type PreparedOwner = {
  role: RelationshipPromotionOwnerRole;
  ownerPath: string;
  targetPath: string;
  expectedHash: string;
  original: Awaited<ReturnType<typeof readVaultFile>>;
  content?: string;
};

export async function promoteKeptRelationshipToMetadata(
  vault: VaultInfo,
  index: VaultIndexResponse,
  raw: unknown,
  cwd = process.cwd(),
): Promise<RelationshipPromotionResult> {
  requireRelationshipPromotionPermissions(vault);
  const request = promotionRequest(raw);
  if (!index.index.notes[request.currentPath] || !index.index.notes[request.relatedPath]) {
    throw new PublicApiError(404, "Relationship promotion requires two indexed Markdown notes.", {
      code: "relationship-promotion-source-unavailable",
    });
  }
  await requireKeptRelatedNotesCurationDecision(
    vault,
    request.currentPath,
    request.relatedPath,
    cwd,
  );

  // Check both canonical source states and both optimistic preconditions before
  // either source can be mutated.
  const current = await readVaultFile(vault, request.currentPath);
  const related = await readVaultFile(vault, request.relatedPath);
  if (
    current.hash !== request.expectedHashes.current ||
    related.hash !== request.expectedHashes.related
  ) {
    throw promotionConflict();
  }

  const requestedRoles: RelationshipPromotionOwnerRole[] =
    request.ownership === "both" ? ["current", "related"] : [request.ownership];
  const prepared = requestedRoles.map((role) =>
    prepareOwner(request, role, role === "current" ? current : related),
  );
  const results: RelationshipPromotionOwnerResult[] = [];

  // For Both, preparation and publication remain deterministically ordered as
  // current note followed by related note.
  for (const owner of prepared) {
    if (owner.content === undefined) {
      results.push({
        role: owner.role,
        ownerPath: owner.ownerPath,
        targetPath: owner.targetPath,
        status: "already-present",
        file: withoutContent(owner.original),
      });
      continue;
    }
    try {
      const file = await writeVaultFile(vault, owner.ownerPath, owner.content, {
        expectedHash: owner.expectedHash,
      });
      results.push({
        role: owner.role,
        ownerPath: owner.ownerPath,
        targetPath: owner.targetPath,
        status: "promoted",
        file,
      });
    } catch (error) {
      if (request.ownership !== "both" || results.length === 0) throw error;
      results.push(failedOwner(owner, error));
      return {
        status: "partial",
        ownership: request.ownership,
        currentPath: request.currentPath,
        relatedPath: request.relatedPath,
        results,
        diagnostic: PARTIAL_WRITE_DIAGNOSTIC,
      };
    }
  }

  return clearAfterCompleteSuccess(vault, request, results, cwd);
}

function promotionRequest(raw: unknown): PromotionRequest {
  if (
    !isRecord(raw) ||
    !hasOnlyKeys(raw, ["ownership", "currentPath", "relatedPath", "expectedHashes"]) ||
    (raw.ownership !== "current" && raw.ownership !== "related" && raw.ownership !== "both") ||
    !isRecord(raw.expectedHashes) ||
    !hasOnlyKeys(raw.expectedHashes, ["current", "related"]) ||
    !isHash(raw.expectedHashes.current) ||
    !isHash(raw.expectedHashes.related)
  ) {
    throw invalidPromotion();
  }
  const currentPath = promotionPath(raw.currentPath);
  const relatedPath = promotionPath(raw.relatedPath);
  if (currentPath === relatedPath) throw invalidPromotion();
  return {
    ownership: raw.ownership,
    currentPath,
    relatedPath,
    expectedHashes: {
      current: raw.expectedHashes.current,
      related: raw.expectedHashes.related,
    },
  };
}

function prepareOwner(
  request: PromotionRequest,
  role: RelationshipPromotionOwnerRole,
  original: Awaited<ReturnType<typeof readVaultFile>>,
): PreparedOwner {
  const ownerPath = role === "current" ? request.currentPath : request.relatedPath;
  const targetPath = role === "current" ? request.relatedPath : request.currentPath;
  const expectedHash =
    role === "current" ? request.expectedHashes.current : request.expectedHashes.related;
  const target = targetPath.replace(/\.md$/i, "");
  const edit = addRelatedMetadataEntry(original.content, target);
  if (edit.status === "malformed") {
    throw new PublicApiError(409, "Markdown frontmatter is malformed and was not changed.", {
      code: "related-metadata-malformed",
    });
  }
  if (edit.status === "unsupported") {
    throw new PublicApiError(
      409,
      "The existing related metadata cannot be safely edited automatically.",
      { code: "related-metadata-unsupported" },
    );
  }
  return {
    role,
    ownerPath,
    targetPath,
    expectedHash,
    original,
    ...(edit.status === "updated" ? { content: edit.content } : {}),
  };
}

function failedOwner(owner: PreparedOwner, error: unknown): RelationshipPromotionOwnerResult {
  if (error instanceof PublicApiError) {
    return {
      role: owner.role,
      ownerPath: owner.ownerPath,
      targetPath: owner.targetPath,
      status: "failed",
      error: error.publicMessage,
      code: error.code ?? "relationship-promotion-write-failed",
    };
  }
  return {
    role: owner.role,
    ownerPath: owner.ownerPath,
    targetPath: owner.targetPath,
    status: "failed",
    error: "The requested note metadata could not be written.",
    code: "relationship-promotion-write-failed",
  };
}

async function clearAfterCompleteSuccess(
  vault: VaultInfo,
  request: PromotionRequest,
  results: RelationshipPromotionOwnerResult[],
  cwd: string,
): Promise<RelationshipPromotionResult> {
  const result: RelationshipPromotionResult = {
    status: "complete",
    ownership: request.ownership,
    currentPath: request.currentPath,
    relatedPath: request.relatedPath,
    results,
  };
  try {
    await clearRelatedNotesCurationDecision(
      vault,
      { leftPath: request.currentPath, rightPath: request.relatedPath },
      cwd,
    );
    return result;
  } catch {
    return { ...result, curationDiagnostic: CURATION_CLEAR_DIAGNOSTIC };
  }
}

function withoutContent(
  file: Awaited<ReturnType<typeof readVaultFile>>,
): Awaited<ReturnType<typeof writeVaultFile>> {
  const { content: _content, ...metadata } = file;
  return metadata;
}

function promotionPath(value: unknown): string {
  try {
    return normalizeMarkdownFilePath(value);
  } catch {
    throw invalidPromotion();
  }
}

export function requireRelationshipPromotionPermissions(vault: VaultInfo): void {
  if (
    !vault.permissions.readIndex ||
    !vault.permissions.readContent ||
    !vault.permissions.writeContent
  ) {
    throw new PublicApiError(403, "Relationship promotion is not permitted.", {
      code: "relationship-promotion-not-permitted",
    });
  }
}

function invalidPromotion(): PublicApiError {
  return new PublicApiError(400, "Relationship promotion request is invalid.", {
    code: "invalid-relationship-promotion",
  });
}

function promotionConflict(): PublicApiError {
  return new PublicApiError(
    409,
    "Source changed on disk. Reload before adding relationship metadata.",
    { code: "VAULT_FILE_CONFLICT" },
  );
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}
