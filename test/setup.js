// Setup file to configure the JSDOM environment for Monaco Editor

// Mock browser APIs needed by Monaco
if (!globalThis.CSS)
    globalThis.CSS = {escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`)};

window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
});

// Create fake observers
window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};

window.IntersectionObserver = class IntersectionObserver {
    constructor(callback) {
        this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
};

// Mock requestAnimationFrame and cancelAnimationFrame if not available
if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = callback => setTimeout(callback, 0);
}

if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = id => clearTimeout(id);
}

// Add missing getBoundingClientRect implementation
if (window.HTMLElement && !window.HTMLElement.prototype.getBoundingClientRect) {
    window.HTMLElement.prototype.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
    });
}

// Handle some Monaco-specific globals
global.MonacoEnvironment = {
    getWorkerUrl: () => "./monaco-editor-worker-loader-proxy.js",
};
