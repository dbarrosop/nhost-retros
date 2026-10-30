import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForRoute } from "./lib/api.ts";
import { definition, endpoints } from "./lib/target.ts";

vi.mock("node:timers/promises", () => ({
  setTimeout: (delay: number) => new Promise((resolve) => globalThis.setTimeout(resolve, delay)),
}));

const target = {
  ...definition,
  databaseId: randomUUID(),
  endpoints: endpoints(definition.subdomain, definition.httpPort),
};

type Response = { status: number; body: string };
function route(replies: Response[]) {
  let count = 0;
  return vi.spyOn(http, "request").mockImplementation((_url, _options, onResponse) => {
    const req = new EventEmitter() as http.ClientRequest;
    req.end = vi.fn(() => {
      const reply = replies[Math.min(count++, replies.length - 1)];
      const response = new EventEmitter() as http.IncomingMessage;
      response.statusCode = reply.status;
      response.setEncoding = vi.fn().mockReturnValue(response);
      onResponse?.(response);
      response.emit("data", reply.body);
      response.emit("end");
      return req;
    });
    return req;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("routed service readiness", () => {
  it("waits past Traefik plain-text 404 and JSON errors using only GET healthz", async () => {
    vi.useFakeTimers();
    const probe = route([
      { status: 404, body: "404 page not found\n" },
      { status: 200, body: '{"errors":[{"message":"not ready"}]}' },
      { status: 200, body: '"OK"\n' },
    ]);
    const ready = waitForRoute(target, "auth");
    await vi.runAllTimersAsync();
    await ready;
    expect(probe).toHaveBeenCalledTimes(3);
    for (const [url, options] of probe.mock.calls) {
      expect(String(url)).toBe(`${target.endpoints.auth}/healthz`);
      expect(options).toMatchObject({ method: "GET", timeout: 8_000 });
    }
  });

  it("fails after at most ten probes, not an unbounded readiness retry", async () => {
    vi.useFakeTimers();
    const probe = route([{ status: 503, body: '{"error":"unavailable"}' }]);
    const failed = expect(waitForRoute(target, "auth")).rejects.toThrow(
      "route did not become ready",
    );
    await vi.runAllTimersAsync();
    await failed;
    expect(probe).toHaveBeenCalledTimes(10);
  });

  it("stops at the wall-clock deadline even when probes take most of their timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const probe = route([{ status: 503, body: "null" }]);
    probe.mockImplementation((_url, options) => {
      const req = new EventEmitter() as http.ClientRequest;
      req.end = vi.fn(() => {
        vi.advanceTimersByTime((options as http.RequestOptions).timeout ?? 0);
        req.emit("error", new Error("Connection unavailable"));
        return req;
      });
      return req;
    });
    const failed = expect(waitForRoute(target, "auth")).rejects.toThrow(
      "route did not become ready",
    );
    await vi.runAllTimersAsync();
    await failed;
    expect(probe).toHaveBeenCalledTimes(3);
    expect(probe.mock.calls.map(([, options]) => (options as http.RequestOptions).timeout)).toEqual(
      [8_000, 8_000, 7_000],
    );
  });
});
