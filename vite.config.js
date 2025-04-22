import {defineConfig} from "vite";
import {resolve} from "path";
import {fileURLToPath} from "url";
import monacoEditorPlugin from "vite-plugin-monaco-editor";
import {viteStaticCopy} from "vite-plugin-static-copy";
import yaml from "@rollup/plugin-yaml";
import {nodePolyfills} from "vite-plugin-node-polyfills";
import {createHtmlPlugin} from "vite-plugin-html";
import jsbeebWorkletPlugin from "./jsbeeb-worklet-middleware.js";

// Get the directory name equivalent in ESM
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    plugins: [
        // Add our custom middleware for jsbeeb worklets
        jsbeebWorkletPlugin(),
        monacoEditorPlugin({}),
        nodePolyfills(),
        yaml(),
        createHtmlPlugin({
            inject: {
                data: {
                    injectAnalytics: true,
                    analytics: {
                        path: resolve(__dirname, "src/analytics.html"),
                    },
                },
            },
        }),
        viteStaticCopy({
            targets: [
                {
                    src: "node_modules/jsbeeb/public/roms/**/*",
                    dest: "roms",
                    globOptions: {
                        ignore: ["**/*.txt", "**/*README*"],
                    },
                },
                {
                    src: "node_modules/jsbeeb/public/sounds/**/*",
                    dest: "sounds",
                },
            ],
        }),
    ],
    assetsInclude: ["**/*.ttf", "**/*.rom"],
    build: {
        // This setting is critical for worklets to work correctly
        // It prevents worklet files from being inlined which would break them
        assetsInlineLimit: 0,
        outDir: "dist",
        minify: true,
        sourcemap: true,
        chunkSizeWarningLimit: 5000,
        rollupOptions: {
            external: ["electron"],
            output: {
                manualChunks: {
                    vendor: ["jquery", "underscore"],
                    monaco: ["monaco-editor"],
                    jsbeeb: ["jsbeeb"],
                },
            },
        },
    },
    server: {
        port: 8080,
    },

    css: {
        devSourcemap: true,
        preprocessorOptions: {
            less: {
                javascriptEnabled: true,
            },
        },
    },
});
