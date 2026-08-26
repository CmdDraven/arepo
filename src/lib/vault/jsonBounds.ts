import type { VaultFileKind } from "./contracts.js";

export const JSON_RAW_CONTENT_MAX_BYTES = 8 * 1024 * 1024;
export const CHAT_JSON_STRUCTURED_MAX_BYTES = 4 * 1024 * 1024;
export const CHAT_JSON_MAX_MESSAGES = 10_000;
export const CHAT_JSON_MAX_MESSAGE_TEXT_LENGTH = 100_000;
export const CHAT_JSON_MAX_AGGREGATE_TEXT_LENGTH = 4_000_000;
export const SOURCE_TOO_LARGE_CODE = "source-too-large";

export function isJsonSourceKind(kind: VaultFileKind): boolean {
  return kind === "chat-json" || kind === "generic-json";
}
