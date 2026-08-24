import test from "node:test";
import assert from "node:assert/strict";

import { globalErrorForLoadFailure } from "./loadFailure.ts";

const sensitiveError = new Error("EACCES: permission denied, open '/private/example/secret.txt'");

test("source-content failures never enter the global vault error channel", () => {
  const globalError = globalErrorForLoadFailure("source-content", sensitiveError);

  assert.equal(globalError, null);
  assert.equal(String(globalError).includes("/private/example/secret.txt"), false);
  assert.equal(String(globalError).includes("EACCES"), false);
});

test("whole-vault failures retain the global vault error channel", () => {
  const error = new Error("Could not obtain the vault file list");

  assert.equal(globalErrorForLoadFailure("whole-vault", error), error.message);
  assert.equal(globalErrorForLoadFailure("whole-vault", "unexpected"), "Unknown error");
});

test("file-list and structural-index failures remain whole-vault failures", async () => {
  for (const failure of [
    new Error("Could not obtain vault metadata"),
    new Error("Could not obtain the structural index"),
  ]) {
    const rejectedVaultRequest = Promise.reject(failure);

    await assert.rejects(rejectedVaultRequest, (error) => {
      assert.equal(globalErrorForLoadFailure("whole-vault", error), failure.message);
      return true;
    });
  }
});
