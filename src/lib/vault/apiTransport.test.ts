import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiRequestError,
  ApiResponseValidationError,
  INVALID_API_RESPONSE_MESSAGE,
  decodeApiResponse,
  isObjectRecord,
  isPublicApiError,
} from "./apiTransport.ts";

const isGreeting = (value: unknown): value is { greeting: string } =>
  isObjectRecord(value) && typeof value.greeting === "string";

test("valid API responses are returned without cloning", async () => {
  const payload = { greeting: "hello", nested: { retained: true } };
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "json", { value: async () => payload });
  const decoded = await decodeApiResponse(response, isGreeting);

  assert.equal(decoded, payload);
  assert.equal(decoded.nested.retained, true);
});

test("malformed successful JSON and non-JSON bodies produce one bounded error", async () => {
  const secret = "/private/example/source.json PRIVATE-BODY";
  for (const response of [
    new Response(JSON.stringify({ greeting: 42, secret }), { status: 200 }),
    new Response(`<html>${secret}</html>`, { status: 200 }),
  ]) {
    await assert.rejects(decodeApiResponse(response, isGreeting), (error: unknown) => {
      assert.ok(error instanceof ApiResponseValidationError);
      assert.equal(error.message, INVALID_API_RESPONSE_MESSAGE);
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    });
  }
});

test("validated public errors retain safe code and reason fields", async () => {
  const response = new Response(
    JSON.stringify({
      ok: false,
      error: "Source is too large to preview safely.",
      code: "source-too-large",
      reason: "raw-preview-limit",
    }),
    { status: 413 },
  );

  await assert.rejects(decodeApiResponse(response, isGreeting), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.code, "source-too-large");
    assert.equal(error.reason, "raw-preview-limit");
    return true;
  });
});

test("malformed error payloads never expose their response body", async () => {
  const secret = "EACCES /private/example/secret-vault";
  const response = new Response(JSON.stringify({ ok: false, error: { raw: secret } }), {
    status: 500,
  });

  await assert.rejects(decodeApiResponse(response, isGreeting), (error: unknown) => {
    assert.ok(error instanceof ApiResponseValidationError);
    assert.equal(error.message, INVALID_API_RESPONSE_MESSAGE);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test("public error envelopes reject wrong optional field types", () => {
  assert.equal(isPublicApiError({ ok: false, error: "No", code: "conflict" }), true);
  assert.equal(isPublicApiError({ ok: false, error: "No", code: 409 }), false);
  assert.equal(isPublicApiError({ ok: false, error: "No", reason: null }), false);
  assert.equal(isPublicApiError({ ok: false, error: "x".repeat(513) }), false);
  assert.equal(isPublicApiError({ ok: false, error: "No", code: "x".repeat(129) }), false);
});
