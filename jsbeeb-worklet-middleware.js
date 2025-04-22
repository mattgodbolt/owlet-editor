// jsbeeb-worklet-middleware.js
// A Vite plugin that provides middleware to handle jsbeeb worklet files
import {build} from "esbuild";
import {resolve} from "path";
import fs from "fs";
import mime from "mime-types";

// Path to jsbeeb in node_modules
// Using '.' is more reliable than process.cwd() and avoids ESLint errors
const jsbeebPath = resolve(".", "node_modules/jsbeeb");

// Base path to jsbeeb sound files
const jsbeebSoundsPath = resolve(jsbeebPath, "public/sounds");

// Create Vite plugin
export default function jsbeebWorkletPlugin() {
    console.log("Initializing jsbeeb worklet middleware plugin");

    // Map of worklet endpoints to their source files (using Map for better performance)
    const workletMap = new Map([
        ["audio-renderer.js", resolve(jsbeebPath, "src/web/audio-renderer.js")],
        ["music5000-worklet.js", resolve(jsbeebPath, "src/music5000-worklet.js")],
    ]);

    // Helper function for handling errors consistently
    function handleError(res, message, error, statusCode = 500) {
        console.error(`[jsbeeb-worklet-middleware] ${message}:`, error);
        res.statusCode = statusCode;
        res.end(`${message}: ${error.message}`);
    }

    // Helper function to serve sound files
    function serveSound(soundPath, res) {
        try {
            // Ensure the sound file exists
            if (!fs.existsSync(soundPath)) {
                handleError(
                    res,
                    `Sound file not found: ${soundPath}`,
                    {message: "File not found"},
                    404,
                );
                return;
            }

            console.log(`[jsbeeb-worklet-middleware] Serving sound file from: ${soundPath}`);

            // Read the sound file as binary
            const soundData = fs.readFileSync(soundPath);

            // Determine content type based on file extension
            const contentType = mime.lookup(soundPath) || "application/octet-stream";

            res.setHeader("Content-Type", contentType);
            res.setHeader("Content-Length", soundData.length);
            res.end(soundData);
        } catch (error) {
            handleError(res, "Error serving sound file", error);
        }
    }

    // Helper function to build and serve a worklet
    async function serveWorklet(sourcePath, res) {
        try {
            // Ensure the source file exists
            if (!fs.existsSync(sourcePath)) {
                handleError(
                    res,
                    `Worklet source file not found: ${sourcePath}`,
                    {message: "File not found"},
                    404,
                );
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
            handleError(res, "Error building worklet", error);
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

            // Check if this is a worklet file that needs transformation
            // Use the workletMap values to identify worklet source files
            for (const [, sourcePath] of workletMap) {
                if (id.includes(sourcePath)) {
                    console.log(`[transform] Transforming worklet file: ${id}`);
                    // No transformations needed for the worklet files themselves, just ensure they're processed
                    return code;
                }
            }

            // Add other transformation rules for different files if needed
            return null; // Return null to let Vite handle the file normally
        },

        configureServer(server) {
            console.log("[jsbeeb-worklet-middleware] Setting up middleware for worklets");

            // Add the main middleware handler using recommended Vite approach
            server.middlewares.use(async (req, res, next) => {
                const url = req.url;
                const parsedUrl = new URL(url, "http://localhost");
                const pathname = parsedUrl.pathname;

                // Log all relevant requests for debugging
                if (
                    pathname.includes("jsbeeb") ||
                    pathname.includes("worklet") ||
                    pathname.includes("smoothie") ||
                    pathname.includes("sounds/")
                ) {
                    console.log(`[jsbeeb-worklet-middleware] Request: ${pathname}`);
                }

                // Check for smoothie.js import
                if (pathname.includes("smoothie.js")) {
                    console.log(`[jsbeeb-worklet-middleware] Intercepting smoothie.js`);
                    const shimPath = resolve(".", "src/smoothie-shim.js");

                    try {
                        const content = fs.readFileSync(shimPath, "utf8");
                        res.setHeader("Content-Type", "application/javascript");
                        res.end(content);
                    } catch (error) {
                        handleError(res, "Error serving smoothie shim", error);
                    }
                    return;
                }

                // Handle sound file requests with a general pattern
                if (pathname.startsWith("/sounds/")) {
                    // Map the URL path to the corresponding file in jsbeeb node_modules
                    const soundPath = resolve(
                        jsbeebSoundsPath,
                        pathname.substring("/sounds/".length),
                    );
                    console.log(`[jsbeeb-worklet-middleware] Serving sound file: ${pathname}`);
                    serveSound(soundPath, res);
                    return;
                }

                // Extract worklet name from URL path for various patterns
                let workletName = null;

                // Check for dedicated endpoints first (most specific)
                if (pathname.startsWith("/jsbeeb-worklets/")) {
                    workletName = pathname.substring("/jsbeeb-worklets/".length);
                }
                // Then check for any other pattern containing known worklet names
                else {
                    for (const [key] of workletMap) {
                        if (pathname.includes(key)) {
                            workletName = key;
                            break;
                        }
                    }
                }

                // If we found a worklet name, try to serve it
                if (workletName && workletMap.has(workletName)) {
                    console.log(`[jsbeeb-worklet-middleware] Serving worklet: ${workletName}`);
                    try {
                        await serveWorklet(workletMap.get(workletName), res);
                    } catch (error) {
                        handleError(res, `Error serving worklet ${workletName}`, error);
                    }
                    return;
                }

                // Otherwise continue with the next middleware
                next();
            });
        },
    };
}
