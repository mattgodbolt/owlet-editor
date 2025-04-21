import { builtinEnvironments } from 'vitest/environments';

export default {
  name: 'monaco',
  // Force jsdom mode to ensure browser environment
  async setup(global, options) {
    // Set up jsdom environment
    const jsdomEnv = await builtinEnvironments.jsdom.setup(global, options);
    
    // Mock browser APIs needed by Monaco
    global.window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    });
    
    // Create a fake ResizeObserver
    global.window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    
    // Create a fake IntersectionObserver
    global.window.IntersectionObserver = class IntersectionObserver {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    
    // More needed browser APIs
    global.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    });
    
    return {
      teardown: async () => {
        await jsdomEnv.teardown();
      },
    };
  },
};
