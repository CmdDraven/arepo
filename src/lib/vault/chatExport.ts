export type ChatConversationV1 = {
  id: string;
  title?: string;
};

export type ChatMessageV1 = {
  id: string;
  author: string;
  timestamp: string;
  text: string;
};

export type ChatExportV1 = {
  format: "arepo-chat-export";
  version: 1;
  conversation: ChatConversationV1;
  messages: ChatMessageV1[];
};

export type ChatExportValidationCode =
  | "invalid-json"
  | "invalid-root"
  | "unsupported-format"
  | "unsupported-version"
  | "invalid-conversation"
  | "missing-conversation-id"
  | "invalid-conversation-title"
  | "invalid-messages"
  | "invalid-message"
  | "duplicate-message-id"
  | "invalid-timestamp";

export type ChatExportParseResult =
  | { ok: true; data: ChatExportV1 }
  | { ok: false; error: { code: ChatExportValidationCode; message: string } };

const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseChatExportV1(source: string): ChatExportParseResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return failure("invalid-json", "Chat source is not valid JSON.");
  }

  if (!isRecord(value)) {
    return failure("invalid-root", "Chat source root must be an object.");
  }
  if (value.format !== "arepo-chat-export") {
    return failure("unsupported-format", 'Chat source format must be "arepo-chat-export".');
  }
  if (value.version !== 1) {
    return failure("unsupported-version", "Chat source version must be numeric version 1.");
  }
  if (!isRecord(value.conversation)) {
    return failure("invalid-conversation", "Chat conversation must be an object.");
  }
  if (typeof value.conversation.id !== "string" || value.conversation.id.trim().length === 0) {
    return failure("missing-conversation-id", "Chat conversation id must be a non-empty string.");
  }
  if (value.conversation.title !== undefined && typeof value.conversation.title !== "string") {
    return failure("invalid-conversation-title", "Chat conversation title must be a string.");
  }
  if (!Array.isArray(value.messages)) {
    return failure("invalid-messages", "Chat messages must be an array.");
  }

  const messageIds = new Set<string>();
  const messages: ChatMessageV1[] = [];
  for (const [index, candidate] of value.messages.entries()) {
    if (!isRecord(candidate)) return invalidMessage(index, "must be an object");
    if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
      return invalidMessage(index, "id must be a non-empty string");
    }
    if (messageIds.has(candidate.id)) {
      return failure(
        "duplicate-message-id",
        `Chat message id is duplicated at record index ${index}.`,
      );
    }
    if (typeof candidate.author !== "string") {
      return invalidMessage(index, "author must be a string");
    }
    if (typeof candidate.timestamp !== "string" || !isTimestampWithTimezone(candidate.timestamp)) {
      return failure(
        "invalid-timestamp",
        `Chat message timestamp is invalid at record index ${index}.`,
      );
    }
    if (typeof candidate.text !== "string") {
      return invalidMessage(index, "text must be a string");
    }
    messageIds.add(candidate.id);
    messages.push({
      id: candidate.id,
      author: candidate.author,
      timestamp: candidate.timestamp,
      text: candidate.text,
    });
  }

  return {
    ok: true,
    data: {
      format: "arepo-chat-export",
      version: 1,
      conversation: {
        id: value.conversation.id,
        ...(value.conversation.title !== undefined ? { title: value.conversation.title } : {}),
      },
      messages,
    },
  };
}

export function chatExportSearchText(chat: ChatExportV1): string {
  return [
    chat.conversation.id,
    chat.conversation.title,
    ...chat.messages.flatMap((message) => [message.id, message.author, message.text]),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

export function chatExportSearchTextFromSource(source: string): string | null {
  const parsed = parseChatExportV1(source);
  return parsed.ok ? chatExportSearchText(parsed.data) : null;
}

function isTimestampWithTimezone(value: string): boolean {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  if (!yearText || !monthText || !dayText || !hourText || !minuteText || !secondText || !zone) {
    return false;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidMessage(index: number, detail: string): ChatExportParseResult {
  return failure("invalid-message", `Chat message at record index ${index} ${detail}.`);
}

function failure(code: ChatExportValidationCode, message: string): ChatExportParseResult {
  return { ok: false, error: { code, message } };
}
