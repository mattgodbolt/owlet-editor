import prettier from "eslint-plugin-prettier";
import eslintConfigPrettier from "eslint-config-prettier";
import js from "@eslint/js";
import globals from "globals";

export default [
    {
        ignores: ["**/dist"],
    },
    js.configs.recommended,
    eslintConfigPrettier,
    {
        plugins: {prettier},
        languageOptions: {
            globals: globals.browser,

            ecmaVersion: 2020,
            sourceType: "module",
        },

        rules: {
            eqeqeq: "error",
            "no-var": "error",
            semi: "error",
            camelcase: "error",
            "no-unused-vars": [
                "error",
                {
                    caughtErrorsIgnorePattern: "^e$",
                },
            ],
        },
    },
    {
        files: ["**/vite.config.js", "**/test/setup.js", "**/vitest.config.mjs", "tools/**"],

        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
];
