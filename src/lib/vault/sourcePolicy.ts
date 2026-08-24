import type { VaultFileKind } from "./contracts.js";

export type SourcePolicy = Readonly<{
  mutable: boolean;
  contributesToMarkdownIndex: boolean;
}>;

const SOURCE_POLICIES = {
  markdown: {
    mutable: true,
    contributesToMarkdownIndex: true,
  },
  "plain-text": {
    mutable: false,
    contributesToMarkdownIndex: false,
  },
  "chat-json": {
    mutable: false,
    contributesToMarkdownIndex: false,
  },
} as const satisfies Record<VaultFileKind, SourcePolicy>;

export function sourcePolicy(kind: VaultFileKind): SourcePolicy {
  return SOURCE_POLICIES[kind];
}

export function sourceKindForPath(filePath: string): VaultFileKind | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".txt")) return "plain-text";
  if (lower.endsWith(".arepo-chat.json")) return "chat-json";
  return null;
}
