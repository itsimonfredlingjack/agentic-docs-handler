import "@testing-library/jest-dom";

// jsdom does not implement ResizeObserver; provide a no-op stub so that
// libraries such as cmdk (which call it in effects) do not throw.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement Element.prototype.scrollIntoView; stub it.
if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = () => {};
}
