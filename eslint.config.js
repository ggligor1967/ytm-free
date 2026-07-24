import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// R15A.2: @typescript-eslint/no-explicit-any is disabled deliberately, not as
// a blanket recommended-rule bypass. The repo has 31 pre-existing `any`
// usages across 4 files (src/api.ts, src/components/settings/DJSettings.tsx,
// src/components/views/SmartPlaylistView.tsx, src/__tests__/Sidebar.test.tsx)
// at IPC/DOM boundaries. Assigning correct types for all of them is
// type-design work outside this mission's bounded, non-behavioral
// remediation budget. TypeScript `strict` mode is unchanged; this only
// affects ESLint's own reporting of `any`.
const unusedVarsRule = [
  "error",
  { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
];

const wdioGlobals = {
  browser: "readonly",
  driver: "readonly",
  $: "readonly",
  $$: "readonly",
  expect: "readonly",
  multiremotebrowser: "readonly",
};

export default tseslint.config([
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "src-tauri/**",
      "analysis/**",
      "cargo-target/**",
    ],
  },

  // Baseline coverage for any src/**/*.{ts,tsx} not matched by a more
  // specific block below (e.g. a newly added file). Ensures no tracked or
  // future src file is silently linted with zero rules.
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      eqeqeq: "error",
      "no-debugger": "error",
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
    },
  },

  // React application: entry points + components + hooks
  {
    files: ["src/App.tsx", "src/main.tsx", "src/components/**/*.tsx", "src/hooks/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      eqeqeq: "error",
      "no-debugger": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  // react-refresh component-export check: application .tsx component files only
  {
    files: ["src/App.tsx", "src/main.tsx", "src/components/**/*.tsx"],
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
    },
  },

  // browser application: non-component TS modules (api/store/types)
  {
    files: ["src/api.ts", "src/store.ts", "src/types.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      eqeqeq: "error",
      "no-debugger": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },

  // vitest unit tests
  {
    files: ["src/__tests__/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.vitest },
    },
    rules: {
      eqeqeq: "error",
      "no-debugger": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
    },
  },

  // WebdriverIO E2E specs + the wdio launcher config itself (runs in Node)
  {
    files: ["tests/e2e/**/*.ts", "wdio.conf.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.mocha, ...wdioGlobals },
    },
    rules: {
      eqeqeq: "error",
      "no-debugger": "error",
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
    },
  },

  // Node-run TS config + Node scripts (Vite/Vitest config, cleanup script)
  {
    files: ["vite.config.ts", "vitest.config.ts", "scripts/**/*.mjs"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      eqeqeq: "error",
      "no-debugger": "error",
      "@typescript-eslint/no-unused-vars": unusedVarsRule,
    },
  },

  // Plain JS config files (ESM, Node-run)
  {
    files: ["postcss.config.js", "tailwind.config.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      eqeqeq: "error",
      "no-debugger": "error",
    },
  },

  // Claude hook tooling (CommonJS, Node-run — .cjs forces CJS regardless of package "type")
  {
    files: [".claude/hooks/*.cjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      eqeqeq: "error",
      "no-debugger": "error",
    },
  },
]);
