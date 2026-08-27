import test from "node:test";
import assert from "node:assert/strict";

import { sourcePresentation } from "./sourcePresentation.ts";

test("frontend presentation policy is explicit for every supported source kind", () => {
  assert.deepEqual(sourcePresentation("markdown"), { mode: "markdown", readOnly: false });
  assert.deepEqual(sourcePresentation("plain-text"), { mode: "plain-text", readOnly: true });
  assert.deepEqual(sourcePresentation("chat-json"), { mode: "chat-json", readOnly: true });
  assert.deepEqual(sourcePresentation("generic-json"), { mode: "generic-json", readOnly: true });
});
