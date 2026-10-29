import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, resolve, delimiter } from "node:path";
import { homedir } from "node:os";
const root = process.cwd(),
  secrets = [];
const archiveLimit = 256 * 1024 * 1024;
async function uploadArchive(path) {
  if (statSync(path).size >= archiveLimit)
    throw new Error("Site archive must be below 256 MiB before upload.");
  // Direct app-server tool calls do not apply the model tool's file-path adapter.
  // Upload through the same Codex file service and pass its OpenAI file object.
  // The preceding authenticated connector calls refresh the existing Codex login.
  const authPath = resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"), "auth.json");
  const tokens = JSON.parse(readFileSync(authPath, "utf8")).tokens;
  if (!tokens?.access_token || !tokens.account_id)
    throw new Error(
      "Archive upload needs the existing ChatGPT Codex login. Run codex login and retry.",
    );
  secrets.push(tokens.access_token);
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    "ChatGPT-Account-Id": tokens.account_id,
    "Content-Type": "application/json",
  };
  const post = async (endpoint, body) => {
    const response = await fetch(`https://chatgpt.com/backend-api${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(
        `Codex file service returned HTTP ${response.status}. The archive and pushed commit are retained.`,
      );
    return response.json();
  };
  const data = readFileSync(path);
  const file = await post("/files", {
    file_name: basename(path),
    file_size: data.length,
    use_case: "codex",
    codex_connector_id: "connector_20205bf7d4e99a89d7154bb849718324",
    codex_action_name: "save_site_version",
    store_in_library: false,
  });
  if (!file.file_id || !file.upload_url)
    throw new Error("Codex file service returned no upload destination.");
  secrets.push(file.upload_url);
  const uploaded = await fetch(file.upload_url, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "application/gzip" },
    body: data,
    signal: AbortSignal.timeout(60000),
  });
  if (!uploaded.ok) throw new Error(`Archive upload returned HTTP ${uploaded.status}.`);
  const finished = await post(`/files/${encodeURIComponent(file.file_id)}/uploaded`, {});
  if (!finished.download_url) throw new Error("Archive upload returned no download URL.");
  secrets.push(finished.download_url);
  return {
    file_id: file.file_id,
    download_url: finished.download_url,
    file_name: basename(path),
    mime_type: finished.mime_type || "application/gzip",
  };
}

function codexExecutable() {
  if (process.platform !== "win32") return "codex";
  for (const directory of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    const executable = resolve(directory.replace(/^"|"$/g, ""), "codex.exe");
    if (existsSync(executable)) return executable;
  }
  // The desktop app installs versioned binaries without adding them to the
  // user's terminal PATH. Resolve the newest installed binary directly.
  const bin = resolve(
    process.env.LOCALAPPDATA || resolve(homedir(), "AppData/Local"),
    "OpenAI/Codex/bin",
  );
  if (existsSync(bin)) {
    const installed = readdirSync(bin, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(bin, entry.name, "codex.exe"))
      .filter(existsSync)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (installed.length) return installed[0];
  }
  throw new Error(
    "Codex executable was not found on PATH or in the desktop installation. Open or reinstall the Codex desktop app, then retry.",
  );
}

async function connect() {
  const child = spawn(codexExecutable(), ["app-server", "--listen", "stdio://"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const pending = new Map();
  let id = 0;
  const rejectAll = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  child.once("error", rejectAll);
  child.once("close", () =>
    rejectAll(new Error("Codex app server closed. Check your Codex login and Sites connection.")),
  );
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending.get(message.id);
    if (request && !message.method) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    } else if (message.id !== undefined && message.method) {
      // Never accept service approval requests silently.
      child.stdin.write(
        JSON.stringify({
          id: message.id,
          error: { code: -32601, message: "Interactive approval requires the Codex app." },
        }) + "\n",
      );
    }
  });
  const rpc = (method, params) =>
    new Promise((resolveCall, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`${method} timed out; reconcile service state before retrying.`));
      }, 120000);
      pending.set(requestId, { resolve: resolveCall, reject, timer });
      child.stdin.write(JSON.stringify({ id: requestId, method, params }) + "\n");
    });
  try {
    await rpc("initialize", {
      clientInfo: { name: "voltura_places_publish", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    return { rpc, close: () => child.kill() };
  } catch (error) {
    child.kill();
    throw error;
  }
}

export { connect, uploadArchive };
