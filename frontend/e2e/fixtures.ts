import { type Browser, type BrowserContext, test as base, expect } from "@playwright/test";

async function publicAssets(context: BrowserContext) {
  // Linux Chromium can abort Vite entry modules with ERR_NETWORK_CHANGED before
  // React boots. Only public localhost GET assets use the runner's transport.
  // API traffic never matches this origin and remains real browser networking.
  await context.route("http://localhost:5173/**", async (route) => {
    const request = route.request();
    // The document stays on Chromium's transport too: it must establish the
    // real loopback address space for local-network/CORS enforcement.
    if (
      request.method() !== "GET" ||
      !["script", "stylesheet", "font", "image"].includes(request.resourceType())
    )
      return route.continue();
    const page = request.frame().page();
    try {
      const response = await route.fetch({
        // Never forward browser cookies, Authorization or other private headers.
        headers: { accept: "*/*", authorization: "", cookie: "" },
        maxRedirects: 0,
        maxRetries: 0,
        timeout: 10_000,
      });
      await route.fulfill({ response });
    } catch {
      // A redirect/navigation may retire optional Vite/HMR imports after the app
      // has rendered. Likewise timeout teardown closes in-flight routes. Only
      // those browser-confirmed cancellations are benign; real failures surface.
      if (page.isClosed() || request.failure()?.errorText === "net::ERR_ABORTED") return;
      throw new Error(`Local Vite asset unavailable: ${new URL(request.url()).pathname}`);
    }
  });
}

export async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0]) {
  const context = await browser.newContext(options);
  await publicAssets(context);
  return context;
}

export const test = base.extend<{ publicAssets: undefined }>({
  publicAssets: [
    async ({ context }, use) => {
      await publicAssets(context);
      await use(undefined);
    },
    { auto: true },
  ],
});
export { expect };
