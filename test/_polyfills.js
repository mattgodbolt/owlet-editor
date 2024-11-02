import * as jsdom from "jsdom";

// With reference to https://github.com/microsoft/monaco-editor/blob/main/test/unit/all.js
const tmp = new jsdom.JSDOM("<!DOCTYPE html><html><body></body></html>");
global.AMD = true;
global.document = tmp.window.document;
global.navigator = tmp.window.navigator;
global.self = global;
global.document.queryCommandSupported = function () {
    return false;
};
global.UIEvent = tmp.window.UIEvent;

global.window = {
    location: {},
    navigator: tmp.window.navigator,
    document: {
        body: tmp.window.document.body,
        addEventListener: (...args) => tmp.window.document.addEventListener(...args),
    },
    matchMedia: function () {
        return {
            matches: false,
            addEventListener: function () {},
        };
    },
    setInterval: function () {},
    setTimeout: function () {},
};

global.UIEvent = tmp.window.UIEvent;
