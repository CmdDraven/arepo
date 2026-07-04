import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assessProtectedModeStartup } from "./protectedModeStartup.js";
import {
  writeBrowserSessionStore,
  writeCredentialStore,
  writeRevocationStore,
  writeTokenVerifierStore,
  resolveAuthStoragePaths,
} from "./credentialStore.js";
import { nonLocalBindWarning } from "./nodeRuntime.js";

const localRuntime = { nonLocalWarning: undefined };

test("disabled mode tolerates missing auth stores", async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-startup-"));
  const assessment = await assessProtectedModeStartup({
    auth: { mode: "disabled" },
    appDataDir,
    runtime: localRuntime,
  });

  assert.equal(assessment.requestedAuthMode, "disabled");
  assert.equal(assessment.operationalAuthMode, "disabled");
  assert.equal(assessment.protectedModeAvailable, false);
  assert.equal(assessment.protectedModeMayStart, false);
  assert.deepEqual(assessment.missingRequiredStores, []);
  assert.deepEqual(assessment.corruptStores, []);
  assert.equal(assessment.enforcementActive, false);
  assert.equal(assessment.credentialVerificationActive, false);
  assert.equal(assessment.networkExposureSafe, false);
});

test("requested protected mode reports missing required stores as unavailable", async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-startup-"));
  const assessment = await assessProtectedModeStartup({
    auth: { mode: "disabled", requestedMode: "protected" },
    appDataDir,
    runtime: localRuntime,
  });

  assert.equal(assessment.requestedAuthMode, "protected");
  assert.equal(assessment.protectedModeMayStart, false);
  assert.deepEqual(assessment.missingRequiredStores.map((item) => item.store).sort(), [
    "credentials",
    "revocations",
    "sessions",
    "tokenVerifiers",
  ]);
  assert.equal(assessment.networkExposureSafe, false);
});

test("requested protected mode reports corrupt stores with quarantine planning metadata", async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-startup-"));
  await writeCredentialStore(appDataDir, { credentials: [] });
  await writeTokenVerifierStore(appDataDir, { tokenVerifiers: [] });
  await writeBrowserSessionStore(appDataDir, { sessions: [] });
  await writeRevocationStore(appDataDir, { revocations: [] });

  const paths = resolveAuthStoragePaths(appDataDir);
  await fs.writeFile(paths.credentials, "{bad json", "utf8");

  const assessment = await assessProtectedModeStartup({
    auth: { mode: "disabled", requestedMode: "protected" },
    appDataDir,
    runtime: localRuntime,
  });

  assert.equal(assessment.protectedModeMayStart, false);
  assert.equal(assessment.corruptStores.length, 1);
  assert.equal(assessment.corruptStores[0]?.store, "credentials");
  assert.match(assessment.corruptStores[0]?.error ?? "", /Corrupt AREPO auth store/);
  assert.equal(assessment.corruptStores[0]?.quarantineCandidate, `${paths.credentials}.corrupt`);
});

test("requested protected mode reports unsafe auth paths", async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-vault-"));
  const assessment = await assessProtectedModeStartup({
    auth: { mode: "disabled", requestedMode: "protected" },
    appDataDir: path.join(vaultRoot, ".arepo-data"),
    vaultRoots: [vaultRoot],
    runtime: localRuntime,
  });

  assert.equal(assessment.protectedModeMayStart, false);
  assert.equal(assessment.unsafeStorePaths.length, 1);
  assert.match(assessment.unsafeStorePaths[0] ?? "", /must not be placed inside/);
});

test("valid empty stores satisfy requested protected-mode startup availability", async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-startup-"));
  await writeCredentialStore(appDataDir, { credentials: [] });
  await writeTokenVerifierStore(appDataDir, { tokenVerifiers: [] });
  await writeBrowserSessionStore(appDataDir, { sessions: [] });
  await writeRevocationStore(appDataDir, { revocations: [] });

  const assessment = await assessProtectedModeStartup({
    auth: { mode: "disabled", requestedMode: "protected" },
    appDataDir,
    runtime: localRuntime,
  });

  assert.deepEqual(assessment.missingRequiredStores, []);
  assert.deepEqual(assessment.corruptStores, []);
  assert.equal(assessment.protectedModeAvailable, true);
  assert.equal(assessment.protectedModeMayStart, true);
  assert.equal(assessment.enforcementActive, false);
  assert.equal(assessment.credentialVerificationActive, false);
});

test("valid empty stores activate protected-mode startup gate when mode is protected", async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-startup-"));
  await writeCredentialStore(appDataDir, { credentials: [] });
  await writeTokenVerifierStore(appDataDir, { tokenVerifiers: [] });
  await writeBrowserSessionStore(appDataDir, { sessions: [] });
  await writeRevocationStore(appDataDir, { revocations: [] });

  const assessment = await assessProtectedModeStartup({
    auth: { mode: "protected" },
    appDataDir,
    runtime: localRuntime,
  });

  assert.deepEqual(assessment.missingRequiredStores, []);
  assert.deepEqual(assessment.corruptStores, []);
  assert.equal(assessment.protectedModeAvailable, true);
  assert.equal(assessment.protectedModeMayStart, true);
  assert.equal(assessment.enforcementActive, true);
  assert.equal(assessment.credentialVerificationActive, true);
  assert.equal(assessment.auditWiringActive, true);
  assert.equal(assessment.revocationChecksActive, true);
  assert.equal(assessment.csrfOriginEnforcementActive, false);
  assert.equal(assessment.networkExposureSafe, false);
});

test("non-local bind with disabled auth remains unsafe", async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-startup-"));
  const assessment = await assessProtectedModeStartup({
    auth: { mode: "disabled" },
    appDataDir,
    runtime: { nonLocalWarning: nonLocalBindWarning("0.0.0.0") },
  });

  assert.equal(assessment.nonLocalBindWithDisabledAuth, true);
  assert.equal(assessment.enforcementActive, false);
  assert.equal(assessment.auditWiringActive, false);
  assert.equal(assessment.revocationChecksActive, false);
  assert.equal(assessment.csrfOriginEnforcementActive, false);
  assert.equal(assessment.networkExposureSafe, false);
});

test("active request handling mounts protected-mode enforcement", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("enforceProtectedMode"), true);
});
