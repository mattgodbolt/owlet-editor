import {builtinEnvironments} from "vitest/environments";

// With reference to https://github.com/microsoft/monaco-editor/blob/main/test/unit/all.js
// and https://github.com/mswjs/socket.io-binding/blob/0db8a6193f06c2196cfd1880d07e153fa702e591/vitest.node-with-websockets.ts
export default {
    name: "monaco",
    transformMode: "ssr",
    async setup(global, options) {
        const {teardown} = await builtinEnvironments.jsdom.setup(global, options);
        window.matchMedia = function () {
            return {
                matches: false,
                addEventListener: function () {},
            };
        };
        return {teardown};
    },
};
