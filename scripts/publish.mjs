import { readFile, writeFile, mkdir, unlink, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { connect } from "./sites-client.mjs";
const root = process.cwd(),
  checkpoint = ".openai/.local/pending-deployment.json";
const git = (args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const manifest = JSON.parse(await readFile(".openai/hosting.json", "utf8"));
let client;
try {
  if (git(["branch", "--show-current"]) !== "main" || git(["status", "--porcelain"]))
    throw new Error("Publish requires a clean reviewed main commit.");
  if (git(["remote", "get-url", "origin"]) !== "https://github.com/voltura/voltura-places.git")
    throw new Error("Unexpected public origin.");
  const sha = git(["rev-parse", "HEAD"]);
  client = await connect();
  const session = await client.rpc("thread/start", { ephemeral: true, cwd: root });
  const call = async (tool, args) => {
    const r = await client.rpc("mcpServer/tool/call", {
      threadId: session.thread.id,
      server: "codex_apps",
      tool: `sites.${tool}`,
      arguments: args,
    });
    if (r.isError)
      throw new Error(
        r.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n"),
      );
    return r.structuredContent ?? JSON.parse(r.content.find((c) => c.type === "text").text);
  };
  const site = await call("get_site", { project_id: manifest.project_id });
  let pending = existsSync(checkpoint) ? JSON.parse(await readFile(checkpoint, "utf8")) : null;
  if (pending && (pending.project_id !== manifest.project_id || pending.commit_sha !== sha))
    throw new Error("Reconcile the saved deployment before publishing another commit.");
  if (!pending) {
    // Run the same checks used by CI, then build the immutable artifact.
    for (const args of [
      ["node_modules/typescript/bin/tsc", "--noEmit"],
      ["node_modules/vitest/vitest.mjs", "run"],
      ["scripts/build.mjs"],
      ["scripts/test-api.mjs"],
    ])
      await run(process.execPath, args);
    git(["push", "origin", "main"]);
    const credential = await call("create_source_repository_write_credential", {
      project_id: manifest.project_id,
    });
    const skill = await sitesSkill();
    const archive = resolve(tmpdir(), "voltura-places-site.tar.gz");
    const output = await run(
      process.execPath,
      [
        resolve(dirname(skill), "../../scripts/site-workflow.mjs"),
        "--project-id",
        manifest.project_id,
      ],
      JSON.stringify({ credential, commands: [], archivePath: archive }) + "\n",
    );
    const packaged = output
      .trim()
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .findLast((v) => v?.archive && v.commit_sha);
    if (!packaged || packaged.commit_sha !== sha || packaged.project_id !== manifest.project_id)
      throw new Error("Packaged source does not match reviewed main.");
    // Native tool calls in Codex handle the local-file upload adapter. A standalone
    // publisher uses the same authenticated file service as the existing Music publisher.
    const { uploadArchive } = await import("./sites-client.mjs");
    const uploaded = await uploadArchive(packaged.archive);
    const saved = await call("save_site_version", {
      project_id: manifest.project_id,
      commit_sha: sha,
      archive: uploaded,
    });
    pending = {
      project_id: manifest.project_id,
      commit_sha: sha,
      version_id: saved.id,
      audience: site.access_mode,
    };
    await mkdir(dirname(checkpoint), { recursive: true });
    await writeFile(checkpoint, JSON.stringify(pending, null, 2));
  }
  let deployment = pending.deployment_id
    ? await call("get_deployment_status", {
        project_id: manifest.project_id,
        deployment_id: pending.deployment_id,
      })
    : null;
  if (!deployment || deployment.status === "failed") {
    deployment = await call(
      site.access_mode === "admins_only" ? "deploy_private_site_version" : "deploy_site_version",
      { project_id: manifest.project_id, version_id: pending.version_id },
    );
    pending.deployment_id = deployment.id;
    await writeFile(checkpoint, JSON.stringify(pending, null, 2));
  }
  while (["pending", "building", "publishing"].includes(deployment.status)) {
    await new Promise((r) => setTimeout(r, 2000));
    deployment = await call("get_deployment_status", {
      project_id: manifest.project_id,
      deployment_id: deployment.id,
    });
  }
  if (deployment.status !== "succeeded")
    throw new Error("Sites publication failed. Retain and retry the saved version.");
  await unlink(checkpoint);
  console.log(`Published ${sha}\n${deployment.url}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client?.close();
}
async function run(file, args, input) {
  return new Promise((resolveRun, reject) => {
    const p = spawn(file, args, { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }),
      output = [];
    p.stdout.on("data", (chunk) => output.push(chunk));
    p.stderr.on("data", (chunk) => process.stderr.write(chunk));
    p.once("error", reject);
    p.once("exit", (code) =>
      code
        ? reject(new Error(`Command failed (${code})`))
        : resolveRun(Buffer.concat(output).toString()),
    );
    p.stdin.end(input ?? "");
  });
}
async function sitesSkill() {
  const cache = resolve(process.env.CODEX_HOME ?? resolve(homedir(), ".codex"), "plugins/cache");
  const candidates = [];
  for (const registry of await readdir(cache, { withFileTypes: true })) {
    const path = resolve(cache, registry.name, "sites");
    if (!registry.isDirectory() || !existsSync(path)) continue;
    for (const version of await readdir(path, { withFileTypes: true })) {
      const skill = resolve(path, version.name, "skills/sites/SKILL.md");
      if (existsSync(skill)) candidates.push({ skill, time: (await stat(skill)).mtimeMs });
    }
  }
  candidates.sort((a, b) => b.time - a.time);
  if (!candidates.length) throw new Error("Install/enable Sites in Codex.");
  return candidates[0].skill;
}
