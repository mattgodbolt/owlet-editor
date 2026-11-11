import {defineConfig} from "vitest/config";
import base from "../../vitest.config.mjs";

// mergeConfig would add to the base's include, not replace it.
export default defineConfig({
    ...base,
    test: {...base.test, include: ["tools/rom-oracle/highlight.mjs"]},
});
