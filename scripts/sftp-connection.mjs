import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import SftpClient from "ssh2-sftp-client";

export const host = "ssh.voltura.se";
export function credentialPaths(environment = process.env) {
  if (process.platform !== "win32" || !environment.LOCALAPPDATA)
    throw new Error("Publishing requires Windows and PowerShell 7.");
  const directory = path.join(environment.LOCALAPPDATA, "Voltura Air");
  return {
    password: path.join(directory, "site-publish-sftp-password.dpapi"),
    fingerprint: path.join(directory, "site-publish-sftp-host.sha256"),
  };
}

export function loadPassword(paths = credentialPaths(), execute = spawnSync) {
  const command =
    '$credentialPath = [Console]::In.ReadToEnd(); $ciphertext = [IO.File]::ReadAllText($credentialPath); $secure = ConvertTo-SecureString -String $ciphertext; $credential = [PSCredential]::new("Voltura site publishing", $secure); [Console]::Out.Write($credential.GetNetworkCredential().Password)';
  const result = execute("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
    input: paths.password,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !result.stdout)
    throw new Error(
      "Cannot unlock the shared SFTP password. Run npm run publish:site:password from your Windows account.",
    );
  return result.stdout;
}

export async function connectSftp({
  paths = credentialPaths(),
  password = () => loadPassword(paths),
  create = () => new SftpClient(),
  read = readFile,
  write = writeFile,
  makeDirectory = mkdir,
  allowFirstUse = false,
} = {}) {
  let known;
  try {
    known = (await read(paths.fingerprint, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (known && !/^[a-f0-9]{64}$/i.test(known))
    throw new Error("Stored SSH fingerprint is invalid.");
  if (!known && !allowFirstUse)
    throw new Error(
      "No stored SSH fingerprint. First connect using an authorized publish command; listing never creates a trust record.",
    );
  let observed;
  let mismatch = false;
  const client = create();
  try {
    await client.connect({
      host,
      port: 22,
      username: "voltura.se",
      password: password(),
      hostHash: "sha256",
      hostVerifier: (fingerprint) => {
        observed = fingerprint;
        mismatch = Boolean(known && known !== fingerprint);
        return !mismatch;
      },
    });
    if (!known) {
      if (!/^[a-f0-9]{64}$/i.test(observed || ""))
        throw new Error("Server did not supply a valid SSH fingerprint.");
      await makeDirectory(path.dirname(paths.fingerprint), { recursive: true });
      await write(paths.fingerprint, `${observed}\n`, { flag: "wx" });
    }
    return client;
  } catch {
    await client.end().catch(() => {});
    throw new Error(
      mismatch
        ? "SSH host fingerprint changed. Connection rejected."
        : "SFTP connection failed. Check the stored credential, network, and host identity.",
    );
  }
}
