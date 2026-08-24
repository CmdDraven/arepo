export type PublicApiErrorOptions = {
  code?: string;
  reason?: string;
  internalMessage?: string;
};

export class PublicApiError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly code?: string;
  readonly reason?: string;

  constructor(status: number, publicMessage: string, options: PublicApiErrorOptions = {}) {
    super(options.internalMessage ?? publicMessage);
    this.name = "PublicApiError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.code = options.code;
    this.reason = options.reason;
  }
}

export type ApiErrorResponse = {
  status: number;
  body: {
    ok: false;
    error: string;
    code?: string;
    reason?: string;
  };
};

export function apiErrorResponse(error: unknown): ApiErrorResponse {
  if (error instanceof PublicApiError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: error.publicMessage,
        ...(error.code ? { code: error.code } : {}),
        ...(error.reason ? { reason: error.reason } : {}),
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: "Internal server error",
      code: "internal-error",
    },
  };
}
