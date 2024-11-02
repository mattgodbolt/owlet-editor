import globals from "globals";
import path from "node:path";
import {fileURLToPath} from "node:url";
import js from "@eslint/js";
import {FlatCompat} from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    {
        ignores: ["**/dist", "test/_polyfills.js"],
    },
    ...compat.extends("eslint:recommended"),
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.mocha,
            },

            ecmaVersion: 2020,
            sourceType: "module",
        },

        rules: {
            "no-var": "error",
            semi: "error",
            "no-control-regex": "off",
            "no-unused-vars": [
                "error",
                {
                    caughtErrorsIgnorePattern: "^e$",
                },
            ],
        },
    },
    {
        files: ["**/webpack.config.js"],

        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
];
