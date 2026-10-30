import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const previewRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
export const previewPort = 5173;
export const previewOrigin = `http://127.0.0.1:${previewPort}`;
export const previewIdentityPath = "/__places_preview";
export const previewIdentity = {
  app: "voltura-places",
  workspace: createHash("sha256").update(previewRoot).digest("hex"),
};
