import type { BrowserContext } from "@playwright/test";

export async function publicAssets(context: BrowserContext) {
  // Linux Chromium can abort Vite entry modules with ERR_NETWORK_CHANGED before
  // React boots. Only public localhost GET assets use the runner's transport.
  // API traffic never matches this origin and remains real browser networking.
  await context.route("http://localhost:5173/**", async (route) => {
    const request = route.request();
    // The document must establish Chromium's real loopback address space.
    if (
      request.method() !== "GET" ||
      !["script", "stylesheet", "font", "image"].includes(request.resourceType())
    )
      return route.continue();
    const page = request.frame().page();
    try {
      const response = await route.fetch({
        headers: { accept: "*/*", authorization: "", cookie: "" },
        maxRedirects: 0,
        maxRetries: 0,
        timeout: 10_000,
      });
      await route.fulfill({ response });
    } catch (error) {
      // Context teardown disposes APIRequestContext before every page/request
      // event necessarily arrives. This explicit lifecycle error is not a failed
      // asset response; do not suppress ordinary network errors or retry them.
      const disposed =
        error instanceof Error &&
        /^route\.fetch: Request context disposed\.(?:\n|$)/.test(error.message);
      if (page.isClosed() || request.failure()?.errorText === "net::ERR_ABORTED" || disposed)
        return;
      throw new Error(`Local Vite asset unavailable: ${new URL(request.url()).pathname}`);
    }
  });
}
