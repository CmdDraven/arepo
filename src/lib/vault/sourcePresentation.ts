import type { VaultFileKind } from "./contracts.js";
import { sourcePolicy } from "./sourcePolicy.ts";

export type FrontendSourcePresentation = Readonly<{
  mode: "markdown" | "plain-text" | "chat-json" | "generic-json";
  readOnly: boolean;
}>;

export function sourcePresentation(kind: VaultFileKind): FrontendSourcePresentation {
  let mode: FrontendSourcePresentation["mode"];
  switch (kind) {
    case "markdown":
      mode = "markdown";
      break;
    case "plain-text":
      mode = "plain-text";
      break;
    case "chat-json":
      mode = "chat-json";
      break;
    case "generic-json":
      mode = "generic-json";
      break;
  }
  return { mode, readOnly: !sourcePolicy(kind).mutable };
}
