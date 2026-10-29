import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { connectSftp } from "./sftp-connection.mjs";
import { digest } from "./promo-manifest.mjs";
// Invoked only during authorized initial setup. Returned secrets go directly to
// native Sites runtime configuration, never terminal output or public files.
export async function setupEmail() {
  const client = await connectSftp({ allowFirstUse: false });
  try {
    const publicRoot = await client.cwd();
    if (!publicRoot.endsWith("/voltura.se/httpd.www")) throw new Error("Unexpected one.com root");
    const privateRoot = publicRoot.replace(/\/httpd\.www$/, "/httpd.private");
    if ((await client.exists(privateRoot)) !== "d")
      throw new Error("Private hosting directory not found");
    const privateDirectory = `${privateRoot}/voltura-places`,
      configPath = `${privateDirectory}/mail-config.php`;
    if (await client.exists(configPath))
      throw new Error(
        "Places email is already configured; retain existing runtime secret rather than rotating it.",
      );
    for (const path of [privateDirectory, `${privateDirectory}/state`]) {
      const exists = await client.exists(path);
      if (exists && exists !== "d") throw new Error("Unexpected private path");
      if (!exists) await client.mkdir(path);
      await client.chmod(path, 0o700);
    }
    const secret = randomBytes(32).toString("hex");
    const config = Buffer.from(
      `<?php\ndeclare(strict_types=1);\nreturn ['secret'=>'${secret}','stateDirectory'=>'${privateDirectory}/state'];\n`,
    );
    await client.put(config, configPath, { writeStreamOptions: { flags: "wx", mode: 0o600 } });
    await client.chmod(configPath, 0o600);
    for (const path of ["places", "places/mail"]) {
      const exists = await client.exists(path);
      if (exists && exists !== "d") throw new Error("Unexpected public Places path");
      if (!exists) await client.mkdir(path);
    }
    let relay = await readFile(new URL("../mail-relay/relay.php", import.meta.url), "utf8");
    relay = relay.replace("/private/voltura/places-mail-config.php", configPath);
    const bytes = Buffer.from(relay),
      destination = "places/mail/relay.php",
      temporary = `${destination}.places-setup-${randomBytes(12).toString("hex")}`;
    if (await client.exists(destination))
      throw new Error("Relay already exists; inspect it before replacement.");
    await client.put(bytes, temporary, { writeStreamOptions: { flags: "wx" } });
    await client.posixRename(temporary, destination);
    if (digest(await client.get(destination)) !== digest(bytes))
      throw new Error("Relay verification failed");
    return {
      AUTH_SECRET: randomBytes(32).toString("hex"),
      MAIL_RELAY_SECRET: secret,
      MAIL_RELAY_URL: "https://voltura.se/places/mail/relay.php",
    };
  } finally {
    await client.end();
  }
}
