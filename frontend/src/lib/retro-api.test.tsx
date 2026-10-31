import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./query-client";
import { useRetroApi, useRetroQuery } from "./retro-api";

const auth = vi.hoisted(() => ({
  snapshot: {
    generation: 1,
    canQuery: true,
    session: { accessToken: "unit-only", user: { id: "alice", roles: ["user", "facilitator"] } },
  },
}));
vi.mock("./auth", () => ({
  useAuth: () => ({ ...auth.snapshot, store: { getSnapshot: () => auth.snapshot } }),
}));
function setup() {
  vi.useFakeTimers();
  const client = createQueryClient();
  const fetcher = vi.fn(async () => Response.json({ data: { value: "authorized" } }));
  vi.stubGlobal("fetch", fetcher);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </StrictMode>
  );
  return { client, fetcher, wrapper };
}
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  auth.snapshot.generation = 1;
});

describe("foreground query lifecycle", () => {
  it("polls every two seconds, cancels hidden/offline reads, resumes immediately and stops on unmount", async () => {
    const app = setup();
    const hook = renderHook(
      () => useRetroQuery<{ value: string }>("user", ["test"], "query Test { value }"),
      app,
    );
    await advance();
    expect(hook.result.current.data?.value).toBe("authorized");
    const first = app.fetcher.mock.calls.length;
    await advance(1999);
    expect(app.fetcher).toHaveBeenCalledTimes(first);
    await advance(1);
    expect(app.fetcher).toHaveBeenCalledTimes(first + 1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance();
    expect(app.fetcher).toHaveBeenCalledTimes(first + 2);

    let resolve!: (response: Response) => void;
    app.fetcher.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await advance(2000);
    const pendingCall = vi.mocked(fetch).mock.calls.at(-1);
    const signal = pendingCall?.[1]?.signal;
    const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(signal?.aborted).toBe(true);
    const hiddenCalls = app.fetcher.mock.calls.length;
    await advance(6000);
    expect(app.fetcher).toHaveBeenCalledTimes(hiddenCalls);
    // A transport that ignores cancellation still cannot repopulate the cache.
    await act(async () => {
      resolve(Response.json({ data: { value: "late hidden response" } }));
    });
    expect(hook.result.current.data?.value).toBe("authorized");
    visible.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance();
    expect(app.fetcher).toHaveBeenCalledTimes(hiddenCalls + 1);

    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    const offlineCalls = app.fetcher.mock.calls.length;
    await advance(6000);
    expect(app.fetcher).toHaveBeenCalledTimes(offlineCalls);
    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await advance();
    expect(app.fetcher).toHaveBeenCalledTimes(offlineCalls + 1);
    hook.unmount();
    const stopped = app.fetcher.mock.calls.length;
    await advance(6000);
    expect(app.fetcher).toHaveBeenCalledTimes(stopped);
    app.client.clear();
  });
  it("rejects delayed old-generation reads even when transport ignores abort", async () => {
    const app = setup();
    let resolve!: (response: Response) => void;
    app.fetcher.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useRetroQuery("user", ["test"], "query Test { value }"), app);
    await advance();
    const oldRequest = resolve;
    auth.snapshot.generation++;
    await act(async () => {
      await app.client.cancelQueries();
      app.client.clear();
    });
    hook.rerender();
    await advance();
    const newRequest = resolve;
    await act(async () => {
      oldRequest(Response.json({ data: { value: "private old account" } }));
    });
    hook.unmount();
    await act(async () => {
      newRequest(Response.json({ data: { value: "current account" } }));
    });
    expect(
      app.client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.data === undefined),
    ).toBe(true);
    app.client.clear();
  });
  it("aborts pending mutations on teardown and rejects their late response instead of reporting success", async () => {
    const app = setup();
    let resolve!: (response: Response) => void;
    app.fetcher.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useRetroApi("facilitator"), app);
    const result = hook.result.current
      .request("mutation Move { value }")
      .catch((error: Error) => error.name);
    const signal = vi.mocked(fetch).mock.calls.at(-1)?.[1]?.signal;
    hook.unmount();
    expect(signal?.aborted).toBe(true);
    resolve(Response.json({ data: { value: "late move" } }));
    expect(await result).toBe("AbortError");
    app.client.clear();
  });
});
