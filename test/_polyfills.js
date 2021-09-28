import * as jsdom from "jsdom";

const tmp = new jsdom.JSDOM("<!DOCTYPE html><html><body></body></html>");
global.document = tmp.window.document;
global.navigator = tmp.window.navigator;
global.self = global;
global.document.queryCommandSupported = function () {
    return false;
};
global.window = {
    location: {},
    navigator: tmp.window.navigator,
    // Fake out matchMedia for monaco.
    matchMedia: function () {
        return {
            matches: false,
            media: "",
            addListener: function () {},
            removeListener: function () {},
        };
    },
};
