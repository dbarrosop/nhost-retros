import "@testing-library/jest-dom/vitest";
import { onlineManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

// jsdom has no scrolling/layout engine. Router scroll restoration runs in a browser.
Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
Element.prototype.scrollIntoView = vi.fn();

// jsdom 30 has no native modal methods. Unit tests exercise confirmation state;
// Playwright exercises the real top layer, Cancel focus and focus restoration.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
