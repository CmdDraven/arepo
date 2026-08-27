export type ApiGuard<T> = (value: unknown) => value is T;

export const INVALID_API_RESPONSE_MESSAGE = "The server returned an invalid response.";

export class ApiResponseValidationError extends Error {
  readonly reason = "invalid-api-response";

  constructor() {
    super(INVALID_API_RESPONSE_MESSAGE);
    this.name = "ApiResponseValidationError";
  }
}

export class ApiRequestError extends Error {
  readonly code?: string;
  readonly reason?: string;

  constructor(message: string, options: { code?: string; reason?: string } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.code = options.code;
    this.reason = options.reason;
  }
}

export async function requestApi<T>(
  path: string,
  guard: ApiGuard<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return decodeApiResponse(response, guard);
}

export async function decodeApiResponse<T>(response: Response, guard: ApiGuard<T>): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiResponseValidationError();
  }

  if (!response.ok || isPublicApiError(value)) {
    if (!isPublicApiError(value)) throw new ApiResponseValidationError();
    throw new ApiRequestError(value.error, {
      ...(value.code === undefined ? {} : { code: value.code }),
      ...(value.reason === undefined ? {} : { reason: value.reason }),
    });
  }

  if (!guard(value)) throw new ApiResponseValidationError();
  return value;
}

export function isApiResponseValidationError(error: unknown): boolean {
  return error instanceof ApiResponseValidationError;
}

export type PublicApiErrorResponse = {
  ok: false;
  error: string;
  code?: string;
  reason?: string;
};

const MAX_PUBLIC_ERROR_LENGTH = 512;
const MAX_PUBLIC_ERROR_CLASSIFIER_LENGTH = 128;

export function isPublicApiError(value: unknown): value is PublicApiErrorResponse {
  if (
    !isObjectRecord(value) ||
    value.ok !== false ||
    !isBoundedString(value.error, MAX_PUBLIC_ERROR_LENGTH)
  ) {
    return false;
  }
  return (
    optionalBoundedString(value, "code", MAX_PUBLIC_ERROR_CLASSIFIER_LENGTH) &&
    optionalBoundedString(value, "reason", MAX_PUBLIC_ERROR_CLASSIFIER_LENGTH)
  );
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function optionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

export function optionalFiniteNumber(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || isFiniteNumber(record[key]);
}

export function optionalBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "boolean";
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function optionalBoundedString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): boolean {
  return record[key] === undefined || isBoundedString(record[key], maxLength);
}
