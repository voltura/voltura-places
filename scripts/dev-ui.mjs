import { createServer } from "vite";
import {
  previewIdentity,
  previewIdentityPath,
  previewOrigin,
  previewPort,
  previewRoot,
} from "./preview-config.mjs";

if (process.argv.length > 2) {
  throw new Error(`Places uses one fixed preview: ${previewOrigin}/. Port overrides are disabled.`);
}

const reusePreview = async () => {
  try {
    const response = await fetch(`${previewOrigin}${previewIdentityPath}`, {
      signal: AbortSignal.timeout(1500),
    });
    const identity = await response.json();
    if (
      response.ok &&
      identity.app === previewIdentity.app &&
      identity.workspace === previewIdentity.workspace
    ) {
      console.log(`Reuse Places preview: ${previewOrigin}/ (live changes from this checkout).`);
      return true;
    }
  } catch {
    // No matching preview. Strict port binding below distinguishes a free port
    // from another app or checkout; never fall forward to another port.
  }
  return false;
};

if (!(await reusePreview())) {
  const server = await createServer({
    root: previewRoot,
    server: { host: "127.0.0.1", port: previewPort, strictPort: true },
  });
  try {
    await server.listen();
    server.printUrls();
    const stop = async () => {
      await server.close();
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    await server.close();
    // Another invocation may have started the same preview concurrently.
    if (!(await reusePreview())) {
      console.error(`Could not start the Places preview at ${previewOrigin}/.`);
      console.error(
        "If the port is occupied, stop its current server or explicitly switch the checkout being reviewed. Do not choose another port.",
      );
      console.error(error instanceof Error ? error.message : "Preview startup failed.");
      process.exitCode = 1;
    }
  }
}
