import {defineConfig} from "vite";
import {resolve} from "path";
import {fileURLToPath} from "url";
import {execFileSync} from "child_process";
import monacoEditorPluginModule from "vite-plugin-monaco-editor";
import {viteStaticCopy} from "vite-plugin-static-copy";
import yaml from "@rollup/plugin-yaml";
import {nodePolyfills} from "vite-plugin-node-polyfills";
import {createHtmlPlugin} from "vite-plugin-html";

// vite-plugin-monaco-editor is CommonJS, so Node's ESM loader hands back module.exports rather than its default
const monacoEditorPlugin = monacoEditorPluginModule.default ?? monacoEditorPluginModule;

// Get the directory name equivalent in ESM
const __dirname = fileURLToPath(new URL(".", import.meta.url));

// CI sets GITHUB_SHA; elsewhere ask git, and carry on without a sha if that fails (e.g. a tarball)
function gitSha() {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch (e) {
        return "";
    }
}

export default defineConfig({
    define: {
        "import.meta.env.OWLET_GIT_SHA": JSON.stringify(gitSha()),
        "import.meta.env.OWLET_BUILD_DATE": JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    plugins: [
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
                    rename: {stripBase: 4},
                    globOptions: {
                        ignore: ["**/*.txt", "**/*README*"],
                    },
                },
            ],
        }),
    ],
    assetsInclude: ["**/*.ttf", "**/*.rom"],
    build: {
        outDir: "dist",
        minify: true,
        sourcemap: true,
        chunkSizeWarningLimit: 5000,
        rollupOptions: {
            external: ["electron"],
            output: {
                codeSplitting: {
                    groups: [
                        {name: "vendor", test: /node_modules[\\/](jquery|underscore)[\\/]/},
                        {name: "monaco", test: /node_modules[\\/]monaco-editor[\\/]/},
                        {name: "jsbeeb", test: /node_modules[\\/]jsbeeb[\\/]/},
                    ],
                },
            },
        },
    },
    // jsbeeb imports its shaders with ?raw, which esbuild's dependency pre-bundling cannot load,
    // so let Vite serve and transform jsbeeb itself.
    optimizeDeps: {
        exclude: ["jsbeeb"],
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
