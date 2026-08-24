import test from "node:test";
import assert from "node:assert/strict";
import { apiErrorResponse, PublicApiError } from "./publicApiError.js";

const sensitivePath = "/private/example/internal-secret.txt";

test("unexpected errors and thrown values become stable internal failures", () => {
  for (const error of [
    new Error(`arbitrary failure at ${sensitivePath}`),
    Object.assign(new Error(`EACCES: permission denied, open '${sensitivePath}'`), {
      code: "EACCES",
      syscall: "open",
      path: sensitivePath,
    }),
    Object.assign(new Error(`ENOENT: no such file or directory, stat '${sensitivePath}'`), {
      code: "ENOENT",
      syscall: "stat",
      path: sensitivePath,
    }),
    "non-error internal throw",
  ]) {
    const response = apiErrorResponse(error);
    assert.deepEqual(response, {
      status: 500,
      body: { ok: false, error: "Internal server error", code: "internal-error" },
    });
    const serialized = JSON.stringify(response);
    for (const hidden of [
      sensitivePath,
      "EACCES",
      "ENOENT",
      "permission denied",
      "syscall",
      "stack",
    ]) {
      assert.equal(serialized.includes(hidden), false, hidden);
    }
  }
});

test("explicit public errors expose only their bounded public fields", () => {
  const response = apiErrorResponse(
    new PublicApiError(409, "The request conflicts with current state.", {
      code: "conflict",
      reason: "stale-version",
      internalMessage: `Internal conflict while opening ${sensitivePath}`,
    }),
  );
  assert.deepEqual(response, {
    status: 409,
    body: {
      ok: false,
      error: "The request conflicts with current state.",
      code: "conflict",
      reason: "stale-version",
    },
  });
  assert.equal(JSON.stringify(response).includes(sensitivePath), false);
});
