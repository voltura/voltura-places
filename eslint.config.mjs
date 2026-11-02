import babelParser from "@babel/eslint-parser";
import stylistic from "@stylistic/eslint-plugin";

// Oxfmt owns layout. These complementary rules own statement structure/spacing.
const functions = {
  selector:
    ":matches(FunctionDeclaration, ClassDeclaration, ExportNamedDeclaration[declaration.type=/^(Function|Class)Declaration$/], ExportDefaultDeclaration[declaration.type=/^(Function|Class)Declaration$/], VariableDeclaration:has(VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)), ExportNamedDeclaration:has(VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)))",
};

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".artifacts/**",
      ".wrangler/**",
      ".openai/.local/**",
      ".playwright-cli/**",
      "test-results/**",
      "playwright-report/**",
      "worker-configuration.d.ts",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    linterOptions: { noInlineConfig: true },
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { babelrc: false, configFile: false },
      },
    },
    plugins: { "@stylistic": stylistic },
    rules: {
      curly: ["error", "all"],
      "one-var": ["error", "never"],
      "@stylistic/lines-between-class-members": [
        "error",
        "always",
        { exceptAfterSingleLine: true },
      ],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "*", next: functions },
        { blankLine: "always", prev: functions, next: "*" },
      ],
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: { babelOptions: { parserOpts: { plugins: ["typescript"] } } },
    },
  },
  {
    files: ["**/*.{tsx,jsx}"],
    languageOptions: {
      parserOptions: { babelOptions: { parserOpts: { plugins: ["typescript", "jsx"] } } },
    },
  },
];
