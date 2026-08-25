import javascriptPlugin from "@eslint/js";
import globals from "globals";

export default [
  javascriptPlugin.configs.recommended,
  {
    files: ["server.js", "test/**/*.js"],
    languageOptions: {
      globals: { ...globals.nodeBuiltin },
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["log", "error"] }],
    },
  },
];
