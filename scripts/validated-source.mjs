import { execFileSync } from "node:child_process";
// Every promotion must still belong to the reviewed clean main commit.
export function captureValidatedSource(cwd = process.cwd()) {
  const git = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
  const sha = git(["rev-parse", "HEAD"]);
  const assertCurrent = () => {
    if (
      git(["branch", "--show-current"]) !== "main" ||
      git(["rev-parse", "HEAD"]) !== sha ||
      git(["status", "--porcelain"])
    )
      throw new Error(
        "Source changed or is not clean reviewed main; validate again before publishing.",
      );
  };
  assertCurrent();
  return { sha, assertCurrent };
}
