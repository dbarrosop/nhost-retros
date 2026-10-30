import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// jsdom has no scrolling/layout engine. Router scroll restoration runs in a browser.
Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
Element.prototype.scrollIntoView = vi.fn();
