import {defineConfig, mergeConfig} from "vitest/config";
import base from "../../vitest.config.mjs";

export default mergeConfig(
    base,
    defineConfig({test: {include: ["tools/rom-oracle/highlight.mjs"]}}),
);
