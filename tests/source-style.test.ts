import { expect, test } from "vitest";
import { ESLint } from "eslint";
import { transform } from "esbuild";

test("style rules reject drift and fix it without changing the compiled program", async () => {
  const source = `import { join } from "node:path";
export const first = () => join("a", "b");
export function second(value: number) {
  let left = value, right = 2;
  if (left) right += left;
  return right;
}`;
  const checker = new ESLint();
  const [invalid] = await checker.lintText(source, { filePath: "src/style-fixture.ts" });

  expect(invalid.messages.map((message) => message.ruleId)).toEqual(
    expect.arrayContaining(["curly", "one-var", "@stylistic/padding-line-between-statements"]),
  );

  const fixer = new ESLint({ fix: true });
  const [fixed] = await fixer.lintText(source, { filePath: "src/style-fixture.ts" });

  expect(fixed.errorCount).toBe(0);
  expect(fixed.output).toBeDefined();

  const [rechecked] = await checker.lintText(fixed.output!, { filePath: "src/style-fixture.ts" });

  expect(rechecked.messages).toEqual([]);

  const compile = async (code: string) =>
    (await transform(code, { loader: "ts", minifySyntax: true, minifyWhitespace: true })).code;

  expect(await compile(fixed.output!)).toBe(await compile(source));
});

test("TSX and typed class members follow the shared rules", async () => {
  const checker = new ESLint();
  const source = `export class Example {
  value: number = 1;
  render() {
    return <span>{this.value}</span>;
  }
  update(value: number) {
    this.value = value;
  }
}`;
  const [result] = await checker.lintText(source, { filePath: "src/style-fixture.tsx" });

  expect(result.fatalErrorCount).toBe(0);
  expect(result.messages.map((message) => message.ruleId)).toContain(
    "@stylistic/lines-between-class-members",
  );
});

test("generated and private directories stay outside ESLint", async () => {
  const checker = new ESLint();

  for (const path of [
    "dist/server/index.js",
    ".artifacts/style-fixture.ts",
    ".openai/.local/private.js",
    "worker-configuration.d.ts",
  ]) {
    expect(await checker.isPathIgnored(path)).toBe(true);
  }
});

test("inline disable comments cannot bypass the shared style policy", async () => {
  const checker = new ESLint();
  const [result] = await checker.lintText("/* eslint-disable curly */\nif (ready) save();\n", {
    filePath: "src/style-fixture.ts",
  });

  expect(result.messages.map((message) => message.ruleId)).toContain("curly");
});
