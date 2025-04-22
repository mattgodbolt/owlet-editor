// jsbeeb-worklet-middleware.js
// A Vite plugin that provides middleware to handle jsbeeb worklet files
import {build} from "esbuild";
import {resolve} from "path";
import fs from "fs";

// Path to jsbeeb in node_modules
// Using '.' is more reliable than process.cwd() and avoids ESLint errors
const jsbeebPath = resolve(".", "node_modules/jsbeeb");

// Map of worklet endpoints to their source files
const workletMap = {
    "audio-renderer.js": resolve(jsbeebPath, "src/web/audio-renderer.js"),
    "music5000-worklet.js": resolve(jsbeebPath, "src/music5000-worklet.js"),
};

// Base path to jsbeeb sound files
const jsbeebSoundsPath = resolve(jsbeebPath, "public/sounds");

// Create Vite plugin
export default function jsbeebWorkletPlugin() {
    console.log("Initializing jsbeeb worklet middleware plugin");
    // Helper function to serve sound files (WAV, etc.)
    function serveSound(soundPath, res) {
        try {
            // Ensure the sound file exists
            if (!fs.existsSync(soundPath)) {
                console.error(`[jsbeeb-worklet-middleware] Sound file not found: ${soundPath}`);
                res.statusCode = 404;
                res.end(`Sound file not found: ${soundPath}`);
                return;
            }

            console.log(`[jsbeeb-worklet-middleware] Serving sound file from: ${soundPath}`);

            // Read the sound file as binary
            const soundData = fs.readFileSync(soundPath);

            // Set appropriate content type for WAV files
            res.setHeader("Content-Type", "audio/wav");
            res.setHeader("Content-Length", soundData.length);
            res.end(soundData);
        } catch (error) {
            console.error(`[jsbeeb-worklet-middleware] Error serving sound file:`, error);
            res.statusCode = 500;
            res.end(`Error serving sound file: ${error.message}`);
        }
    }

    // Helper function to build and serve a worklet
    async function serveWorklet(sourcePath, res) {
        try {
            // Ensure the source file exists
            if (!fs.existsSync(sourcePath)) {
                console.error(`[jsbeeb-worklet-middleware] Source file not found: ${sourcePath}`);
                res.statusCode = 404;
                res.end(`Worklet source file not found: ${sourcePath}`);
                return;
            }

            // Build the worklet on demand
            console.log(`[jsbeeb-worklet-middleware] Building worklet from: ${sourcePath}`);

            // Read the source file
            const sourceCode = fs.readFileSync(sourcePath, "utf8");

            // For audio worklets, we need to ensure they have the proper context
            // The global 'sampleRate' and 'currentTime' variables are expected in worklets
            const preamble = `
        // Worklet environment setup for development mode
        const sampleRate = 44100;  // Default sample rate for most audio contexts
        const currentTime = globalThis.currentTime || 0;
      `;

            const result = await build({
                stdin: {
                    contents: preamble + sourceCode,
                    loader: "js",
                    resolveDir: resolve(sourcePath, ".."),
                },
                bundle: true,
                write: false,
                format: "iife", // Audio worklets use IIFE format
                target: ["es2020"],
                outfile: "out.js",
                define: {
                    "process.env.NODE_ENV": '"development"',
                },
                // Add any necessary external modules
                external: ["smoothie"],
            });

            // Serve the compiled result
            console.log(`[jsbeeb-worklet-middleware] Serving built worklet`);
            res.setHeader("Content-Type", "application/javascript");
            res.end(result.outputFiles[0].text);
        } catch (error) {
            console.error(`[jsbeeb-worklet-middleware] Error building worklet:`, error);
            res.statusCode = 500;
            res.end(`Error building worklet: ${error.message}`);
        }
    }

    return {
        name: "jsbeeb-worklet-middleware",
        // Add transform hook to handle modules during the transform phase
        transform(code, id) {
            // Look for specific modules to transform
            if (id.includes("jsbeeb/src/web/audio-handler.js")) {
                console.log(`[transform] Transforming audio-handler.js`);

                // Replace the problematic imports and fix audio context for development mode
                return code
                    .replace(
                        `const rendererUrl = new URL("./audio-renderer.js", import.meta.url).href;`,
                        `// Modified by worklet middleware for dev mode
             const rendererUrl = "/jsbeeb-worklets/audio-renderer.js";`,
                    )
                    .replace(
                        `const music5000WorkletUrl = new URL("../music5000-worklet.js", import.meta.url).href;`,
                        `// Modified by worklet middleware for dev mode
             const music5000WorkletUrl = "/jsbeeb-worklets/music5000-worklet.js";`,
                    )
                    .replace(
                        `import { SmoothieChart, TimeSeries } from "smoothie";`,
                        `import { SmoothieChart, TimeSeries } from "/src/smoothie-shim.js";`,
                    );
            }

            // We don't need to transform ddnoise.js - just serve the sound files correctly

            // Also transform the worklet files directly to ensure they're properly formatted for AudioWorklet
            if (
                id.includes("jsbeeb/src/web/audio-renderer.js") ||
                id.includes("jsbeeb/src/music5000-worklet.js")
            ) {
                console.log(`[transform] Transforming worklet file: ${id}`);
                // No transformations needed for the worklet files themselves, just ensure they're processed
                return code;
            }

            // Add other transformation rules for different files if needed
            return null; // Return null to let Vite handle the file normally
        },

        configureServer(server) {
            console.log("[jsbeeb-worklet-middleware] Setting up middleware for worklets");

            // Handler function for smoothie
            const handleSmoothie = (req, res) => {
                console.log(`[jsbeeb-worklet-middleware] Intercepting smoothie.js`);
                const shimPath = resolve(".", "src/smoothie-shim.js");

                try {
                    const content = fs.readFileSync(shimPath, "utf8");
                    res.setHeader("Content-Type", "application/javascript");
                    res.end(content);
                } catch (error) {
                    console.error(
                        `[jsbeeb-worklet-middleware] Error serving smoothie shim:`,
                        error,
                    );
                    res.statusCode = 500;
                    res.end(`Error serving smoothie shim: ${error.message}`);
                }
            };

            // Add the main middleware handler using recommended Vite approach
            server.middlewares.use(async (req, res, next) => {
                const url = req.url;

                // Log all relevant requests for debugging
                if (
                    url.includes("jsbeeb") ||
                    url.includes("worklet") ||
                    url.includes("smoothie") ||
                    url.includes("sounds/")
                ) {
                    console.log(`[jsbeeb-worklet-middleware] Request: ${url}`);
                }

                // Check for the specific imports we need to handle
                if (url.includes("smoothie.js")) {
                    handleSmoothie(req, res);
                    return;
                }

                // Handle sound file requests with a general pattern
                if (url.startsWith("/sounds/") && url.endsWith(".wav")) {
                    // Map the URL path to the corresponding file in jsbeeb node_modules
                    const soundPath = resolve(jsbeebSoundsPath, url.substring("/sounds/".length));
                    console.log(`[jsbeeb-worklet-middleware] Serving sound file: ${url}`);
                    serveSound(soundPath, res);
                    return;
                }

                // Handle dedicated worklet endpoints
                for (const workletKey in workletMap) {
                    if (url === `/jsbeeb-worklets/${workletKey}`) {
                        console.log(`[jsbeeb-worklet-middleware] Serving worklet: ${workletKey}`);
                        try {
                            await serveWorklet(workletMap[workletKey], res);
                        } catch (error) {
                            console.error(`Error serving worklet: ${error.message}`);
                            res.statusCode = 500;
                            res.end(`Error serving worklet: ${error.message}`);
                        }
                        return;
                    }
                }

                // Handle various URL patterns that might be used for worklet requests
                // Simplify pattern matching - the key is that we catch all possible variations
                // of worklet URLs from either the URL import syntax or direct path references
                if (url.includes("audio-renderer.js")) {
                    console.log(`[jsbeeb-worklet-middleware] Serving audio renderer: ${url}`);
                    try {
                        await serveWorklet(workletMap["audio-renderer.js"], res);
                    } catch (error) {
                        console.error(`Error serving audio renderer: ${error.message}`);
                        res.statusCode = 500;
                        res.end(`Error serving worklet: ${error.message}`);
                    }
                    return;
                }

                if (url.includes("music5000-worklet.js")) {
                    console.log(`[jsbeeb-worklet-middleware] Serving music5000 worklet: ${url}`);
                    try {
                        await serveWorklet(workletMap["music5000-worklet.js"], res);
                    } catch (error) {
                        console.error(`Error serving music5000 worklet: ${error.message}`);
                        res.statusCode = 500;
                        res.end(`Error serving worklet: ${error.message}`);
                    }
                    return;
                }

                // Otherwise continue with the next middleware
                next();
            });

            // No need for extra watchers - Vite's HMR will trigger transform hooks automatically
        },
    };
}
