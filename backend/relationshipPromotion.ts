import { addRelatedMetadataEntry } from "../src/lib/vault/frontmatter.js";
import { hasExplicitRelationship } from "../src/lib/vault/indexer.js";
import { normalizeMarkdownFilePath } from "./path.js";
import { PublicApiError } from "./publicApiError.js";
import {
  clearRelatedNotesCurationDecision,
  requireKeptRelatedNotesCurationDecision,
} from "./relatedNotesCuration.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";
import { readVaultFile, writeVaultFile } from "./vaultFs.js";

const CURATION_CLEAR_DIAGNOSTIC =
  "The canonical relationship is present, but its AREPO curation decision could not be cleared.";

export type RelationshipPromotionResult = {
  status: "promoted" | "already-present";
  ownerPath: string;
  targetPath: string;
  file: Awaited<ReturnType<typeof writeVaultFile>>;
  curationDiagnostic?: string;
};

export async function promoteKeptRelationshipToMetadata(
  vault: VaultInfo,
  index: VaultIndexResponse,
  raw: unknown,
  cwd = process.cwd(),
): Promise<RelationshipPromotionResult> {
  requireRelationshipPromotionPermissions(vault);
  if (!isRecord(raw) || !hasOnlyKeys(raw, ["ownerPath", "targetPath", "expectedHash"])) {
    throw invalidPromotion();
  }
  const ownerPath = promotionPath(raw.ownerPath);
  const targetPath = promotionPath(raw.targetPath);
  if (
    ownerPath === targetPath ||
    typeof raw.expectedHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.expectedHash)
  ) {
    throw invalidPromotion();
  }
  if (!index.index.notes[ownerPath] || !index.index.notes[targetPath]) {
    throw new PublicApiError(404, "Relationship promotion requires two indexed Markdown notes.", {
      code: "relationship-promotion-source-unavailable",
    });
  }
  await requireKeptRelatedNotesCurationDecision(vault, ownerPath, targetPath, cwd);
  const owner = await readVaultFile(vault, ownerPath);
  if (owner.hash !== raw.expectedHash) throw promotionConflict();
  await readVaultFile(vault, targetPath);

  if (hasExplicitRelationship(index.index, ownerPath, targetPath)) {
    return clearAfterCanonicalSuccess(
      vault,
      ownerPath,
      targetPath,
      {
        status: "already-present",
        ownerPath,
        targetPath,
        file: withoutContent(owner),
      },
      cwd,
    );
  }

  const target = targetPath.replace(/\.md$/i, "");
  const edit = addRelatedMetadataEntry(owner.content, target);
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
  if (edit.status === "already-present") {
    return clearAfterCanonicalSuccess(
      vault,
      ownerPath,
      targetPath,
      {
        status: "already-present",
        ownerPath,
        targetPath,
        file: withoutContent(owner),
      },
      cwd,
    );
  }

  const file = await writeVaultFile(vault, ownerPath, edit.content, {
    expectedHash: raw.expectedHash,
  });
  return clearAfterCanonicalSuccess(
    vault,
    ownerPath,
    targetPath,
    {
      status: "promoted",
      ownerPath,
      targetPath,
      file,
    },
    cwd,
  );
}

async function clearAfterCanonicalSuccess(
  vault: VaultInfo,
  ownerPath: string,
  targetPath: string,
  result: RelationshipPromotionResult,
  cwd: string,
): Promise<RelationshipPromotionResult> {
  try {
    await clearRelatedNotesCurationDecision(
      vault,
      { leftPath: ownerPath, rightPath: targetPath },
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
    {
      code: "VAULT_FILE_CONFLICT",
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}
