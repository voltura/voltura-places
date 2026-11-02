import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { ESLint } from "eslint";
import * as prettier from "prettier";
import * as phpPlugin from "@prettier/plugin-php";
import { format as formatSQL } from "sql-formatter";

const check = process.argv.includes("--check");
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
    windowsHide: true,
  },
)
  .split("\0")
  .filter(Boolean);
let failed = false;
const eslint = new ESLint({ fix: !check });
const scriptFiles = [];

for (const path of [...new Set(files)]) {
  if (/\.(?:[cm]?js|jsx|ts|tsx)$/.test(path) && !(await eslint.isPathIgnored(path))) {
    try {
      await readFile(path);
      scriptFiles.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

const results = await eslint.lintFiles(scriptFiles);

if (!check) {
  await ESLint.outputFixes(results);
}

const diagnostics = await eslint.loadFormatter("stylish");
const report = diagnostics.format(results);

if (report) {
  console.log(report);
}

if (results.some((result) => result.errorCount || result.warningCount)) {
  failed = true;
}

for (const path of [...new Set(files)]) {
  const extension = extname(path);

  if (extension !== ".php" && extension !== ".sql") {
    continue;
  }

  let source;

  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      continue;
    }

    throw error;
  }

  const formatted =
    extension === ".php"
      ? await prettier.format(source, {
          parser: "php",
          plugins: [phpPlugin],
          phpVersion: "8.2",
          printWidth: 100,
          tabWidth: 4,
          useTabs: false,
          singleQuote: true,
          endOfLine: "lf",
        })
      : formatSQL(source, {
          language: "sqlite",
          tabWidth: 2,
          keywordCase: "upper",
          linesBetweenQueries: 1,
        }).trimEnd() + "\n";

  if (source !== formatted) {
    if (check) {
      console.error(`Formatting required: ${path}`);
      failed = true;
    } else {
      await writeFile(path, formatted);
    }
  }
}

const oxfmt = spawnSync(
  process.execPath,
  ["node_modules/oxfmt/bin/oxfmt", ...(check ? ["--check"] : []), "."],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);

if (oxfmt.error) {
  throw oxfmt.error;
}

if (oxfmt.status !== 0) {
  failed = true;
}

if (failed) {
  console.error("Source style check failed. Run npm run format, then npm run check.");
  process.exitCode = 1;
}
