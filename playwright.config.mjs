import {defineConfig} from "@playwright/test";

const Port = 4791;
const Origin = `http://127.0.0.1:${Port}`;
// CI has just built the page, so it can serve that rather than build it again.
const Serve = `vite preview --host 127.0.0.1 --port ${Port} --strictPort`;

export default defineConfig({
    testDir: "e2e",
    testMatch: "**/*.e2e.js",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: process.env.CI ? [["github"], ["list"]] : "list",
    use: {
        viewport: {width: 1400, height: 900},
        baseURL: Origin,
        trace: "retain-on-failure",
    },
    projects: [{name: "chromium", use: {browserName: "chromium"}}],
    webServer: {
        command: process.env.E2E_SKIP_BUILD ? Serve : `npm run build && ${Serve}`,
        url: Origin,
        timeout: 300000,
        reuseExistingServer: !process.env.CI,
    },
});
