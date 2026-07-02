import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredAllowedOrigins,
  nonLocalBindWarning,
  resolveAuthPosture,
  resolveBackendHost,
  resolveBackendPort,
  resolveBackendRuntimeOptions,
} from "./nodeRuntime.js";

test("node runtime defaults to localhost backend settings", () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(resolveBackendHost(env), "127.0.0.1");
  assert.equal(resolveBackendPort(env), 8734);
  assert.deepEqual(configuredAllowedOrigins(env), [
    "http://localhost:8733",
    "http://127.0.0.1:8733",
  ]);
});

test("node runtime accepts explicit host, port, and CORS origins", () => {
  const env = {
    AREPO_HOST: "127.0.0.1",
    AREPO_PORT: "9002",
    AREPO_ALLOWED_ORIGINS: "http://localhost:9001, http://127.0.0.1:9001",
  } as NodeJS.ProcessEnv;
  const options = resolveBackendRuntimeOptions(env);
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, 9002);
  assert.equal(options.nonLocalWarning, undefined);
  assert.deepEqual(options.allowedOrigins, [
    "http://localhost:8733",
    "http://127.0.0.1:8733",
    "http://localhost:9001",
    "http://127.0.0.1:9001",
  ]);
});

test("node runtime rejects invalid backend ports", () => {
  assert.throws(() => resolveBackendPort({ AREPO_PORT: "abc" } as NodeJS.ProcessEnv), /AREPO_PORT/);
  assert.throws(() => resolveBackendPort({ AREPO_PORT: "0" } as NodeJS.ProcessEnv), /1 to 65535/);
  assert.throws(
    () => resolveBackendPort({ AREPO_PORT: "70000" } as NodeJS.ProcessEnv),
    /1 to 65535/,
  );
});

test("node runtime surfaces a no-auth warning for non-local binding", () => {
  const options = resolveBackendRuntimeOptions({ AREPO_HOST: "0.0.0.0" } as NodeJS.ProcessEnv);
  assert.equal(options.host, "0.0.0.0");
  assert.match(options.nonLocalWarning ?? "", /no authentication/);
  assert.equal(nonLocalBindWarning("0.0.0.0"), options.nonLocalWarning);
});

test("auth posture is disabled and unenforced by default", () => {
  const runtime = resolveBackendRuntimeOptions({} as NodeJS.ProcessEnv);
  const auth = resolveAuthPosture({ mode: "disabled" }, runtime);
  assert.deepEqual(auth, {
    mode: "disabled",
    enabled: false,
    enforcement: "none",
    protectedModeAvailable: false,
    warning: "Authentication is disabled and not enforced in V1 local-only mode.",
  });
});

test("auth posture does not make non-local binding safe", () => {
  const runtime = resolveBackendRuntimeOptions({ AREPO_HOST: "0.0.0.0" } as NodeJS.ProcessEnv);
  const auth = resolveAuthPosture({ mode: "disabled" }, runtime);
  assert.equal(auth.enabled, false);
  assert.equal(auth.enforcement, "none");
  assert.equal(auth.protectedModeAvailable, false);
  assert.match(auth.warning, /non-local binding is unsafe/);
});
