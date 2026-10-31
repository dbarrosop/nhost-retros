import { createNhostClient } from "@nhost/nhost-js";
import type { Session } from "@nhost/nhost-js/auth";
import { MemoryStorage } from "@nhost/nhost-js/session";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStore, authMessage, eligible, normalizeEmail, validEmail } from "./auth-store";
import { authQueryKey, createQueryClient } from "./query-client";

function testSession(id = "first", roles = ["user", "me"], defaultRole = "user"): Session {
  const payload = { sub: id, exp: Date.now() / 1000 + 900 };
  return {
    accessToken: `e30.${btoa(JSON.stringify(payload))}.test`,
    refreshToken: "test-only",
    refreshTokenId: "test-only",
    accessTokenExpiresIn: 900,
    user: {
      id,
      email: `${id}@nhost.io`,
      emailVerified: true,
      isAnonymous: false,
      defaultRole,
      roles,
      displayName: "Test participant",
      locale: "en",
      avatarUrl: "",
      createdAt: "",
      phoneNumberVerified: false,
      metadata: {},
    },
  };
}
function setup(storage = new MemoryStorage()) {
  const client = createNhostClient({ storage, configure: [] });
  const queries = createQueryClient();
  const store = new AuthStore(client, queries);
  return { client, queries, store };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const reply = (body: Session) => ({ body, status: 200, headers: new Headers() });
function sessionLocks() {
  let tail = Promise.resolve();
  const request = vi.fn((_name: string, _options: unknown, action: () => Promise<void>) => {
    const task = tail.then(action);
    tail = task.catch(() => {});
    return task;
  });
  vi.stubGlobal("navigator", { locks: { request }, onLine: true });
  return request;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("auth lifecycle", () => {
  it("restores and retries with a false navigator hint; online events, not the hint, resume Auth", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    onlineManager.setOnline(true);
    const { client, store, queries } = setup();
    client.sessionStorage.set(testSession());
    const refresh = vi.spyOn(client.auth, "refreshToken").mockResolvedValue(reply(testSession()));
    const stop = store.start();
    try {
      await store.refresh();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot().canQuery).toBe(true);
      refresh.mockRejectedValueOnce(new TypeError("LAN transport interruption"));
      await store.refresh();
      await vi.advanceTimersByTimeAsync(1000);
      expect(refresh).toHaveBeenCalledTimes(3);
      window.dispatchEvent(new Event("offline"));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(refresh).toHaveBeenCalledTimes(3);
      window.dispatchEvent(new Event("online"));
      await store.refresh();
      expect(refresh).toHaveBeenCalledTimes(4);
      expect(navigator.onLine).toBe(false);
      expect(store.getSnapshot().canQuery).toBe(true);
    } finally {
      stop();
      queries.clear();
    }
  });
  it("restores a seeded facilitator through StrictMode start/cleanup/start with a queued Web Lock", async () => {
    sessionLocks();
    const { client, store, queries } = setup();
    client.sessionStorage.set(testSession("first", ["user", "me", "facilitator"]));
    const refresh = vi
      .spyOn(client.auth, "refreshToken")
      .mockResolvedValue(reply(testSession("first", ["user", "me", "facilitator"])));
    const firstStop = store.start();
    firstStop();
    const stop = store.start();
    try {
      await store.refresh();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot().ready).toBe(true);
      expect(store.getSnapshot().canQuery).toBe(true);
      expect(store.getSnapshot().session?.user?.roles).toContain("facilitator");
      expect(store.getDataSignal().aborted).toBe(false);
    } finally {
      stop();
      queries.clear();
    }
  });
  it("keeps local signout authoritative and reports a failed server revocation", async () => {
    const { client, store, queries } = setup();
    client.sessionStorage.set(testSession());
    vi.spyOn(client.auth, "refreshToken").mockResolvedValue(reply(testSession()));
    vi.spyOn(client.auth, "signOut").mockRejectedValue(new TypeError("Offline"));
    const stop = store.start();
    try {
      await store.refresh();
      queries.setQueryData(["private"], "old account");
      await store.signOut();
      expect(store.getSnapshot().session).toBeNull();
      expect(store.getSnapshot().notice).toContain("Server sign-out couldn’t be confirmed");
      expect(queries.getQueryCache().getAll()).toHaveLength(0);
    } finally {
      stop();
      queries.clear();
    }
  });
  it("pauses JWT access at expiry even while refresh is pending, and aborts private mutations", async () => {
    vi.useFakeTimers();
    const { client, store, queries } = setup();
    client.sessionStorage.set(testSession());
    const delayed = deferred<ReturnType<typeof reply>>();
    vi.spyOn(client.auth, "refreshToken")
      .mockResolvedValueOnce(reply(testSession()))
      .mockReturnValue(delayed.promise);
    const stop = store.start();
    try {
      await store.refresh();
      const signal = store.getDataSignal();
      queries.setQueryData(["private"], "expired account data");
      const expires = client.getUserSession()?.decodedToken.exp ?? 0;
      const refreshing = store.refresh();
      await vi.advanceTimersByTimeAsync(expires - Date.now());
      expect(store.getSnapshot().canQuery).toBe(false);
      expect(signal.aborted).toBe(true);
      expect(queries.getQueryCache().getAll()).toHaveLength(0);
      delayed.resolve(reply(testSession()));
      await refreshing;
      expect(store.getSnapshot().canQuery).toBe(true);
    } finally {
      stop();
      queries.clear();
    }
  });
  it("does not refresh repeatedly while hidden/offline and resumes on foreground reconnection", async () => {
    vi.useFakeTimers();
    const { client, store, queries } = setup();
    client.sessionStorage.set(testSession());
    const refresh = vi
      .spyOn(client.auth, "refreshToken")
      .mockImplementation(async () => reply(testSession()));
    const stop = store.start();
    try {
      await store.refresh();
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(900_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot().canQuery).toBe(false);
      visibility.mockReturnValue("visible");
      const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      online.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
      await store.refresh();
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(store.getSnapshot().canQuery).toBe(true);
    } finally {
      stop();
      queries.clear();
    }
  });
  it("cannot overwrite a same-tab account switch with an earlier refresh", async () => {
    const { client, store, queries } = setup();
    client.sessionStorage.set(testSession());
    const refresh = vi
      .spyOn(client.auth, "refreshToken")
      .mockResolvedValueOnce(reply(testSession()));
    const stop = store.start();
    try {
      await store.refresh();
      const delayed = deferred<ReturnType<typeof reply>>();
      refresh.mockReturnValue(delayed.promise);
      const refreshing = store.refresh();
      client.sessionStorage.set(testSession("second"));
      expect(refresh.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
      delayed.resolve(reply(testSession()));
      await refreshing;
      expect(store.getSnapshot().session?.user?.id).toBe("second");
    } finally {
      stop();
      queries.clear();
    }
  });
  it("normalizes email without restricting its domain", () => {
    expect(normalizeEmail("  PERSON@ACME.LOCAL  ")).toBe("person@acme.local");
    for (const value of ["  PERSON@ACME.LOCAL ", "person@sub.nhost.io", "person@example.com"])
      expect(validEmail(value)).toBe(true);
    for (const value of [
      "",
      "person",
      "person@",
      "@example.com",
      "a@@example.com",
      "a b@example.com",
      "a@localhost",
    ])
      expect(validEmail(value)).toBe(false);
  });
  it.each(["person@acme.local", "person@example.com", "person@sub.nhost.io"])(
    "admits a verified account at %s",
    (email) => {
      const { client } = setup();
      const session = testSession();
      if (session.user) session.user.email = email;
      client.sessionStorage.set(session);
      expect(eligible(client.getUserSession())).toBe(true);
    },
  );
  it("does not admit unverified, anonymous, malformed or non-user sessions", () => {
    const { client } = setup();
    for (const patch of [
      { emailVerified: false },
      { isAnonymous: true },
      { defaultRole: "me" },
      { email: "not-an-email" },
      { roles: ["me"] },
      { roles: ["facilitator"] },
    ]) {
      const session = testSession();
      Object.assign(session.user ?? {}, patch);
      client.sessionStorage.set(session);
      expect(eligible(client.getUserSession())).toBe(false);
    }
  });
  it.each(["user", "facilitator"])(
    "accepts an eligible facilitator with %s as the default role",
    (defaultRole) => {
      const { client } = setup();
      client.sessionStorage.set(
        testSession("facilitator", ["user", "me", "facilitator"], defaultRole),
      );
      expect(eligible(client.getUserSession())).toBe(true);
    },
  );
  it("keeps a successful OTP session with facilitator as its default role", async () => {
    const { client, store, queries } = setup();
    const session = testSession("facilitator", ["user", "me", "facilitator"], "facilitator");
    const verify = vi.spyOn(client.auth, "verifySignInOTPEmail").mockResolvedValue({
      body: { session },
      status: 200,
      headers: new Headers(),
    });
    const stop = store.start();
    try {
      await store.refresh();
      await store.verify("FACILITATOR@NHOST.IO", " 123456 ");
      expect(verify).toHaveBeenCalledWith(
        { email: "facilitator@nhost.io", otp: "123456" },
        { signal: expect.any(AbortSignal) },
      );
      expect(store.getSnapshot().canQuery).toBe(true);
      expect(store.getSnapshot().session?.user?.defaultRole).toBe("facilitator");
      expect(client.getUserSession()?.user?.roles).toContain("facilitator");
    } finally {
      stop();
      queries.clear();
    }
  });
  it("restores a facilitator-default session through refresh", async () => {
    const { client, store, queries } = setup();
    const session = testSession("facilitator", ["user", "me", "facilitator"], "facilitator");
    client.sessionStorage.set(session);
    vi.spyOn(client.auth, "refreshToken").mockResolvedValue(reply(session));
    const stop = store.start();
    try {
      await store.refresh();
      expect(store.getSnapshot().ready).toBe(true);
      expect(store.getSnapshot().canQuery).toBe(true);
      expect(store.getSnapshot().session?.user?.defaultRole).toBe("facilitator");
      expect(client.getUserSession()).not.toBeNull();
    } finally {
      stop();
      queries.clear();
    }
  });
  it("reports account eligibility rejection separately from invalid OTP codes", async () => {
    const { client, store, queries } = setup();
    const session = testSession();
    if (session.user) session.user.emailVerified = false;
    vi.spyOn(client.auth, "verifySignInOTPEmail").mockResolvedValue({
      body: { session },
      status: 200,
      headers: new Headers(),
    });
    try {
      await expect(store.verify("first@nhost.io", "123456")).rejects.toMatchObject({
        status: 403,
        code: "ineligible-session",
      });
      expect(client.getUserSession()).toBeNull();
      const message = authMessage({ status: 403, code: "ineligible-session" }, true);
      expect(message).toContain("account");
      expect(message).not.toContain("code is invalid");
      expect(authMessage({ status: 403 }, true)).toContain("code is invalid");
    } finally {
      queries.clear();
    }
  });
  it("restores through refresh and clears private queries on identity/role changes, but not token rotation", async () => {
    const { client, queries, store } = setup();
    client.sessionStorage.set(testSession());
    vi.spyOn(client.auth, "refreshToken").mockResolvedValue(reply(testSession()));
    const stop = store.start();
    try {
      await store.refresh();
      expect(store.getSnapshot().ready).toBe(true);
      const generation = store.getSnapshot().generation;
      const key = authQueryKey(generation, "first", "user");
      queries.setQueryData(key, "private draft response");
      client.sessionStorage.set(testSession());
      expect(queries.getQueryData(key)).toBe("private draft response");
      client.sessionStorage.set(testSession("first", ["facilitator", "user", "me"]));
      expect(queries.getQueryCache().getAll()).toHaveLength(0);
      expect(store.getSnapshot().generation).toBe(generation + 1);
      client.sessionStorage.set(testSession("second"));
      expect(store.getSnapshot().generation).toBe(generation + 2);
    } finally {
      stop();
      queries.clear();
    }
  });
  it.each([
    new TypeError("Network unavailable"),
    new DOMException("Timed out", "TimeoutError"),
    { status: 503 },
    { status: 429 },
  ])(
    "retains valid sessions and private queries on transient refresh failure (%s), then retries",
    async (error) => {
      vi.useFakeTimers();
      const { client, store, queries } = setup();
      client.sessionStorage.set(testSession());
      const refresh = vi.spyOn(client.auth, "refreshToken").mockResolvedValue(reply(testSession()));
      const stop = store.start();
      try {
        await store.refresh();
        const generation = store.getSnapshot().generation;
        queries.setQueryData(["private"], "still authorized");
        refresh.mockRejectedValueOnce(error);
        window.dispatchEvent(new Event("focus"));
        await store.refresh();
        expect(store.getSnapshot().session?.user?.id).toBe("first");
        expect(store.getSnapshot().notice).toContain("retry automatically");
        expect(store.getSnapshot().generation).toBe(generation);
        expect(queries.getQueryData(["private"])).toBe("still authorized");
        expect(client.getUserSession()).not.toBeNull();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(refresh).toHaveBeenCalledTimes(3);
        expect(store.getSnapshot().notice).toBe("");
        expect(store.getSnapshot().generation).toBe(generation);
      } finally {
        stop();
        queries.clear();
      }
    },
  );
  it.each([
    new TypeError("Offline"),
    new DOMException("Timed out", "TimeoutError"),
    { status: 503 },
    { status: 429 },
  ])(
    "retains refresh credentials at JWT expiry (%s), pauses data once and recovers",
    async (error) => {
      vi.useFakeTimers();
      const { client, store, queries } = setup();
      client.sessionStorage.set(testSession());
      const expires = client.getUserSession()?.decodedToken.exp ?? 0;
      const refresh = vi.spyOn(client.auth, "refreshToken").mockRejectedValue(error);
      const forget = vi.spyOn(client, "clearSession");
      const stop = store.start();
      try {
        await store.refresh();
        expect(store.getSnapshot().ready).toBe(true);
        expect(store.getSnapshot().session?.user?.id).toBe("first");
        expect(store.getSnapshot().canQuery).toBe(true);
        const generation = store.getSnapshot().generation;
        queries.setQueryData(["private"], "old identity");
        const clear = vi.spyOn(queries, "clear");
        vi.setSystemTime(expires);
        await store.refresh();
        expect(client.getUserSession()).not.toBeNull();
        expect(store.getSnapshot().session?.user?.id).toBe("first");
        expect(store.getSnapshot().canQuery).toBe(false);
        expect(store.getSnapshot().generation).toBe(generation + 1);
        expect(store.getSnapshot().notice).toContain("Reconnecting");
        expect(queries.getQueryCache().getAll()).toHaveLength(0);
        expect(clear).toHaveBeenCalledTimes(1);
        // Backoff grows to ten seconds, never to a zero-delay loop at/after expiry.
        for (const delay of [2000, 4000, 8000, 10_000, 10_000]) {
          const calls = refresh.mock.calls.length;
          await vi.advanceTimersByTimeAsync(delay - 1);
          expect(refresh).toHaveBeenCalledTimes(calls);
          await vi.advanceTimersByTimeAsync(1);
          expect(refresh).toHaveBeenCalledTimes(calls + 1);
          expect(store.getSnapshot().canQuery).toBe(false);
          expect(store.getSnapshot().generation).toBe(generation + 1);
          expect(client.getUserSession()).not.toBeNull();
        }
        expect(clear).toHaveBeenCalledTimes(1);
        expect(forget).not.toHaveBeenCalled();
        refresh.mockResolvedValue(reply(testSession()));
        // Reconnection retries immediately, without another OTP or loss of account shell.
        window.dispatchEvent(new Event("online"));
        await store.refresh();
        expect(store.getSnapshot().session?.user?.id).toBe("first");
        expect(store.getSnapshot().canQuery).toBe(true);
        expect(store.getSnapshot().notice).toBe("");
        expect(store.getSnapshot().generation).toBe(generation + 2);
        expect(client.getUserSession()).not.toBeNull();
        expect(forget).not.toHaveBeenCalled();
        // Successful refresh resets the retry backoff.
        refresh.mockRejectedValueOnce(error);
        await store.refresh();
        const calls = refresh.mock.calls.length;
        await vi.advanceTimersByTimeAsync(1000);
        expect(refresh).toHaveBeenCalledTimes(calls + 1);
        expect(store.getSnapshot().notice).toBe("");
      } finally {
        stop();
        queries.clear();
      }
    },
  );
  it.each(["expired", "ineligible"])(
    "forgets a %s session on an authoritative refresh rejection",
    async (reason) => {
      const { client, store, queries } = setup();
      client.sessionStorage.set(testSession());
      const refresh = vi.spyOn(client.auth, "refreshToken").mockResolvedValue(reply(testSession()));
      const stop = store.start();
      try {
        await store.refresh();
        queries.setQueryData(["private"], "old identity");
        const session = testSession();
        if (reason === "ineligible") Object.assign(session.user ?? {}, { emailVerified: false });
        else {
          const payload = { sub: "first", exp: Date.now() / 1000 - 1 };
          session.accessToken = `e30.${btoa(JSON.stringify(payload))}.test`;
        }
        client.sessionStorage.set(session);
        refresh.mockRejectedValue(reason === "expired" ? { status: 401 } : { status: 503 });
        await store.refresh();
        expect(client.getUserSession()).toBeNull();
        expect(store.getSnapshot().session).toBeNull();
        expect(store.getSnapshot().canQuery).toBe(false);
        expect(queries.getQueryCache().getAll()).toHaveLength(0);
      } finally {
        stop();
        queries.clear();
      }
    },
  );
  it("rejects a delayed verification after signout even if transport ignores abort", async () => {
    const { client, store } = setup();
    const delayed = deferred<{ body: { session: Session }; status: number; headers: Headers }>();
    const verify = vi.spyOn(client.auth, "verifySignInOTPEmail").mockReturnValue(delayed.promise);
    const stop = store.start();
    try {
      const result = store.verify("first@nhost.io", "123456").catch((error) => error.name);
      await store.signOut();
      expect(verify.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      delayed.resolve({ body: { session: testSession() }, status: 200, headers: new Headers() });
      expect(await result).toBe("AbortError");
      expect(client.getUserSession()).toBeNull();
      expect(store.getSnapshot().session).toBeNull();
    } finally {
      stop();
    }
  });
  it("does not accept a delayed refresh after signout or overwrite a cross-tab account change", async () => {
    const { client, store } = setup();
    client.sessionStorage.set(testSession());
    const delayed = deferred<ReturnType<typeof reply>>();
    vi.spyOn(client.auth, "refreshToken").mockReturnValue(delayed.promise);
    vi.spyOn(client.auth, "signOut").mockResolvedValue({
      body: "OK",
      status: 200,
      headers: new Headers(),
    });
    const stop = store.start();
    try {
      await store.signOut();
      client.sessionStorage.set(testSession("second"));
      window.dispatchEvent(new StorageEvent("storage", { key: "nhostSession" }));
      delayed.resolve(reply(testSession()));
      await delayed.promise;
      await Promise.resolve();
      expect(store.getSnapshot().session?.user?.id).toBe("second");
    } finally {
      stop();
    }
  });
  it("serializes signout after a cross-tab rotation, suppresses storage sync and revokes the rotated token", async () => {
    const locks = sessionLocks();
    const storage = new MemoryStorage();
    const first = setup(storage);
    const second = setup(storage);
    first.client.sessionStorage.set(testSession());
    vi.spyOn(first.client.auth, "refreshToken").mockResolvedValue(reply(testSession()));
    const stopFirst = first.store.start();
    await first.store.refresh();
    first.queries.setQueryData(["private"], "old account");
    const started = deferred<void>();
    const delayed = deferred<ReturnType<typeof reply>>();
    vi.spyOn(second.client.auth, "refreshToken").mockImplementation(() => {
      started.resolve();
      return delayed.promise;
    });
    const revoke = vi.spyOn(first.client.auth, "signOut").mockResolvedValue({
      body: "OK",
      status: 200,
      headers: new Headers(),
    });
    const stopSecond = second.store.start();
    const rotated = { ...testSession(), refreshToken: "rotated-test-only" };
    let suppressedRotation = false;
    const unsubscribe = second.client.sessionStorage.onChange((session) => {
      if (session) {
        // Deliver the rotation before the original signout storage event, the race under test.
        window.dispatchEvent(new StorageEvent("storage", { key: "nhostSession" }));
        suppressedRotation = first.store.getSnapshot().session === null;
      }
    });
    try {
      await started.promise;
      const signingOut = first.store.signOut();
      expect(first.store.getSnapshot().session).toBeNull();
      expect(first.queries.getQueryCache().getAll()).toHaveLength(0);
      expect(revoke).not.toHaveBeenCalled();
      delayed.resolve(reply(rotated));
      await signingOut;
      expect(suppressedRotation).toBe(true);
      expect(revoke.mock.calls[0]?.[0]?.refreshToken === rotated.refreshToken).toBe(true);
      expect(first.client.getUserSession()).toBeNull();
      window.dispatchEvent(new StorageEvent("storage", { key: "nhostSession" }));
      expect(second.store.getSnapshot().session).toBeNull();
      expect(locks.mock.calls.every(([name]) => name === "nhostSessionLock")).toBe(true);
    } finally {
      unsubscribe();
      stopFirst();
      stopSecond();
    }
  });
  it("does not rotate a token when another tab’s signout acquired the lock first", async () => {
    sessionLocks();
    const storage = new MemoryStorage();
    const first = setup(storage);
    first.client.sessionStorage.set(testSession());
    vi.spyOn(first.client.auth, "refreshToken").mockResolvedValue(reply(testSession()));
    const stopFirst = first.store.start();
    await first.store.refresh();
    const started = deferred<void>();
    const delayed = deferred<{ body: "OK"; status: number; headers: Headers }>();
    vi.spyOn(first.client.auth, "signOut").mockImplementation(() => {
      started.resolve();
      return delayed.promise;
    });
    const second = setup(storage);
    const refresh = vi.spyOn(second.client.auth, "refreshToken");
    const signingOut = first.store.signOut();
    await started.promise;
    const stopSecond = second.store.start();
    try {
      const refreshing = second.store.refresh();
      delayed.resolve({ body: "OK", status: 200, headers: new Headers() });
      await Promise.all([signingOut, refreshing]);
      expect(refresh).not.toHaveBeenCalled();
      expect(second.store.getSnapshot().session).toBeNull();
      expect(first.client.getUserSession()).toBeNull();
    } finally {
      stopFirst();
      stopSecond();
    }
  });
  it("cross-tab signout cancels/removes old private queries without triggering refresh ping-pong", async () => {
    const { client, store, queries } = setup();
    client.sessionStorage.set(testSession());
    const refresh = vi.spyOn(client.auth, "refreshToken").mockResolvedValue(reply(testSession()));
    const stop = store.start();
    try {
      await store.refresh();
      queries.setQueryData(["private"], "old identity");
      client.clearSession();
      window.dispatchEvent(new StorageEvent("storage", { key: "nhostSession" }));
      expect(store.getSnapshot().session).toBeNull();
      expect(queries.getQueryCache().getAll()).toHaveLength(0);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
  it("cleans an invalid refresh and reports network/429/invalid-code failures without raw engine errors", async () => {
    expect(authMessage({ status: 429, body: "private error" })).toContain("Too many attempts");
    expect(authMessage(new TypeError("secret"))).toContain("connect");
    expect(authMessage({ status: 400 }, true)).toContain("expired or already used");
    const { client, store } = setup();
    client.sessionStorage.set(testSession());
    vi.spyOn(client.auth, "refreshToken").mockRejectedValue({ status: 401 });
    const stop = store.start();
    try {
      await store.refresh();
      expect(client.getUserSession()).toBeNull();
      expect(store.getSnapshot().ready).toBe(true);
    } finally {
      stop();
    }
  });
});
