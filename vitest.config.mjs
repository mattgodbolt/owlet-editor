import {configDefaults, defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        include: [...configDefaults.include, "test/**/*_test.js"],
        environmentMatchGlobs: [["test/bbcbasic_test.js", "./test/vitest-environment-monaco.js"]],
    },
});
