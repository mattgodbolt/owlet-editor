import {configDefaults, defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        include: [...configDefaults.include, "test/**/*_test.js"],
        // Use browser environment for all tests that need browser APIs
        environment: 'jsdom',
        // Handle missing source maps gracefully
        sourcemapIgnoreList: path => path.includes('node_modules'),
        // Only test files in our project, not in node_modules
        testTimeout: 20000,
        exclude: ['**/node_modules/**'],
        // Setup a global browser environment for monaco tests
        setupFiles: ['./test/setup.js'],
    },
});
