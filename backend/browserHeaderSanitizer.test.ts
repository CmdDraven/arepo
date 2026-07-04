import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_HEADER_SANITIZER_NETWORK_EXPOSURE_SAFE,
  BROWSER_HEADER_SANITIZER_WIRED_INTO_AUTHORIZATION,
  BROWSER_HEADER_SANITIZER_WIRED_INTO_ROUTES,
  getBrowserHeaderSanitizerDiagnostics,
  isSensitiveBrowserAuthHeader,
  sanitizeBrowserAuthHeaders,
  sanitizeBrowserRequestMetadata,
} from "./browserHeaderSanitizer.js";

const secretSamples = [
  "Bearer arepo_secret_token",
  "arepo_session=bsess_test.bsver_secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_token",
  "sha256:verifierHash",
] as const;

test("header sanitizer redacts browser auth credential headers", () => {
  const sanitized = sanitizeBrowserAuthHeaders({
    Cookie: "arepo_session=bsess_test.bsver_secret",
    Authorization: "Bearer arepo_secret_token",
    "Set-Cookie": "arepo_session=secret",
    "X-CSRF-Token": "bcsrfsec_secret",
    "X-XSRF-TOKEN": "xsrf-secret",
    Origin: "http://127.0.0.1:8734",
  });

  assert.deepEqual(sanitized.redactedHeaders, {
    authorization: "[redacted]",
    cookie: "[redacted]",
    "set-cookie": "[redacted]",
    "x-csrf-token": "[redacted]",
    "x-xsrf-token": "[redacted]",
  });
  assert.equal(sanitized.safeHeaders.origin, "http://127.0.0.1:8734");
  assert.equal(sanitized.redactedHeaderCount, 5);
  assert.equal(sanitized.networkExposureSafe, false);
});

test("header sanitizer recognizes sensitive header names", () => {
  assert.equal(isSensitiveBrowserAuthHeader("cookie"), true);
  assert.equal(isSensitiveBrowserAuthHeader("authorization"), true);
  assert.equal(isSensitiveBrowserAuthHeader("set-cookie"), true);
  assert.equal(isSensitiveBrowserAuthHeader("x-csrf-token"), true);
  assert.equal(isSensitiveBrowserAuthHeader("x-xsrf-token"), true);
  assert.equal(isSensitiveBrowserAuthHeader("origin"), false);
});

test("header sanitizer allowlists safe metadata without exposing secrets", () => {
  const sanitized = sanitizeBrowserRequestMetadata({
    method: "POST",
    routeId: "POST /api/node/auth/session",
    origin: "http://localhost:8734/some/path",
    host: "localhost:8734",
    remoteAddress: "127.0.0.1",
    headers: {
      Authorization: "Bearer arepo_secret_token",
      Cookie: "arepo_session=bsess_test.bsver_secret",
      Host: "localhost:8734",
      "X-Unrelated": "should-not-pass-through",
    },
  });
  const serialized = JSON.stringify(sanitized);

  assert.equal(sanitized.method, "POST");
  assert.equal(sanitized.routeId, "POST /api/node/auth/session");
  assert.equal(sanitized.origin, "http://localhost:8734");
  assert.equal(sanitized.host, "localhost:8734");
  assert.equal(sanitized.locality, "localhost");
  assert.equal(sanitized.headers?.safeHeaders.host, "localhost:8734");
  assert.equal("x-unrelated" in (sanitized.headers?.safeHeaders ?? {}), false);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(serialized.includes("arepo_session="), false);
  assert.equal(serialized.includes("bsver_secret"), false);
});

test("header sanitizer classifies local network and non-local metadata", () => {
  assert.equal(sanitizeBrowserRequestMetadata({ host: "localhost:8734" }).locality, "localhost");
  assert.equal(sanitizeBrowserRequestMetadata({ host: "127.0.0.1:8734" }).locality, "localhost");
  assert.equal(
    sanitizeBrowserRequestMetadata({ host: "192.168.1.10:8734" }).locality,
    "local-network",
  );
  assert.equal(
    sanitizeBrowserRequestMetadata({ origin: "https://example.test" }).locality,
    "non-local",
  );
  assert.equal(sanitizeBrowserRequestMetadata({}).locality, "unknown");
});

test("header sanitizer diagnostics are inactive and safe", () => {
  const diagnostics = getBrowserHeaderSanitizerDiagnostics();
  const serialized = JSON.stringify(diagnostics);

  assert.equal(BROWSER_HEADER_SANITIZER_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_HEADER_SANITIZER_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_HEADER_SANITIZER_WIRED_INTO_ROUTES, false);
  assert.equal(diagnostics.status, "inactive");
  assert.equal(diagnostics.implementation, "header-redaction-test-primitive");
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.redactsCookieHeaders, true);
  assert.equal(diagnostics.redactsAuthorizationHeaders, true);
  assert.equal(diagnostics.redactsSetCookieHeaders, true);
  assert.equal(diagnostics.redactsCsrfHeaders, true);
  assert.equal(diagnostics.allowlistedOutputOnly, true);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("header sanitizer primitives are not wired into live request authorization", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  const enforcementSource = await fs.readFile(
    path.join(process.cwd(), "backend", "protectedModeEnforcement.ts"),
    "utf8",
  );
  const authorizationSource = await fs.readFile(
    path.join(process.cwd(), "backend", "requestAuthorizationPlanner.ts"),
    "utf8",
  );

  for (const source of [serverSource, enforcementSource, authorizationSource]) {
    assert.equal(source.includes("browserHeaderSanitizer"), false);
    assert.equal(source.includes("sanitizeBrowserAuthHeaders"), false);
    assert.equal(source.includes("sanitizeBrowserRequestMetadata"), false);
  }
});
