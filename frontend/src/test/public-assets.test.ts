import type { BrowserContext, Route } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { publicAssets } from "../../e2e/public-assets";

async function fixture({
  method = "GET",
  resource = "script",
  closed = false,
  failure = null as null | { errorText: string },
} = {}) {
  const request = {
    method: () => method,
    resourceType: () => resource,
    frame: () => ({ page: () => ({ isClosed: () => closed }) }),
    failure: () => failure,
    url: () => "http://localhost:5173/@vite/client",
  };
  const route = {
    request: () => request,
    fetch: vi.fn().mockResolvedValue({}),
    fulfill: vi.fn().mockResolvedValue(undefined),
    continue: vi.fn().mockResolvedValue(undefined),
  };
  let handler: ((route: Route) => Promise<void>) | undefined;
  const register = vi.fn(async (_url, callback) => {
    handler = callback;
  });
  await publicAssets({ route: register } as unknown as BrowserContext);
  expect(register.mock.calls[0]?.[0]).toBe("http://localhost:5173/**");
  return {
    route,
    run: () => {
      if (!handler) throw new Error("Missing public asset handler");
      return handler(route as unknown as Route);
    },
  };
}

describe("public browser asset transport", () => {
  it("fetches public assets without credentials, retries or redirects", async () => {
    const { route, run } = await fixture();
    await run();
    expect(route.fetch).toHaveBeenCalledWith({
      headers: { accept: "*/*", authorization: "", cookie: "" },
      maxRedirects: 0,
      maxRetries: 0,
      timeout: 10_000,
    });
    expect(route.fulfill).toHaveBeenCalledOnce();
  });

  it.each([{ method: "POST" }, { resource: "document" }])(
    "keeps non-asset requests on browser transport (%j)",
    async (options) => {
      const { route, run } = await fixture(options);
      await run();
      expect(route.continue).toHaveBeenCalledOnce();
      expect(route.fetch).not.toHaveBeenCalled();
    },
  );

  it("recognizes disposed request context before page/request close events arrive", async () => {
    const { route, run } = await fixture();
    route.fetch.mockRejectedValue(
      new Error("route.fetch: Request context disposed.\nCall log: withheld"),
    );
    await expect(run()).resolves.toBeUndefined();
    expect(route.fulfill).not.toHaveBeenCalled();
  });

  it.each([{ closed: true }, { failure: { errorText: "net::ERR_ABORTED" } }])(
    "accepts browser-confirmed teardown cancellation (%j)",
    async (options) => {
      const { route, run } = await fixture(options);
      route.fetch.mockRejectedValue(new Error("transport cancelled"));
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("still fails real transport errors with sanitized diagnostics and no retry", async () => {
    const { route, run } = await fixture();
    route.fetch.mockRejectedValue(
      new Error("route.fetch: connect ECONNREFUSED; private diagnostics"),
    );
    await expect(run()).rejects.toThrow(/^Local Vite asset unavailable: \/@vite\/client$/);
    expect(route.fetch).toHaveBeenCalledOnce();
  });
});
