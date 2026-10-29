import { readFile, access } from "node:fs/promises";
for (const path of [
  "README.md",
  "AGENTS.md",
  "docs/README.md",
  "docs/architecture.md",
  "docs/data.md",
  "docs/ui.md",
  "docs/deployment.md",
])
  await access(path);
const hosting = JSON.parse(await readFile(".openai/hosting.json", "utf8"));
if (hosting.d1 !== "DB" || !hosting.project_id)
  throw new Error("Places must own its Sites identity and DB binding.");
console.log("Documentation owners and Sites manifest checked.");
