import type { NhostClient, StoredSession } from "@nhost/nhost-js";
import type { QueryClient } from "@tanstack/react-query";
import { clearPrivateQueries } from "./query-client";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const companyEmail = (email: string) => /^[^\s@]+@nhost\.io$/.test(normalizeEmail(email));
export function eligible(session: StoredSession | null): session is StoredSession {
  const user = session?.user;
  return Boolean(
    user?.email &&
      companyEmail(user.email) &&
      user.emailVerified &&
      !user.isAnonymous &&
      user.defaultRole === "user" &&
      user.roles.includes("user"),
  );
}
export function authMessage(error: unknown, verifying = false) {
  const status = (error as { status?: number })?.status;
  if (status === 429) return "Too many attempts. Please wait a few minutes before trying again.";
  if (!navigator.onLine || !status)
    return "We couldn’t connect. Check your connection and try again.";
  return verifying
    ? "That code is invalid, expired or already used. Try again or request a new code."
    : "We couldn’t send a code. Check your email and account choice, or try again later.";
}
type Snapshot = {
  session: StoredSession | null;
  canQuery: boolean;
  ready: boolean;
  generation: number;
  notice: string;
};
const identity = (session: StoredSession | null) =>
  eligible(session)
    ? `${session.user?.id}:${[...(session.user?.roles ?? [])].sort().join(",")}`
    : "";

export class AuthStore {
  private snapshot: Snapshot = {
    session: null,
    canQuery: false,
    ready: false,
    generation: 0,
    notice: "",
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private pending = new Set<AbortController>();
  private refreshTask: Promise<void> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private dataController = new AbortController();
  private refreshBackoffMs = 1000;
  private running = false;
  private signingOut = false;
  private signOutTask: Promise<void> | undefined;
  readonly client: NhostClient;
  private queries: QueryClient;
  constructor(client: NhostClient, queries: QueryClient) {
    this.client = client;
    this.queries = queries;
  }
  getSnapshot = () => this.snapshot;
  getDataSignal = () => this.dataController.signal;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(session: StoredSession | null, ready = true, notice = "", refreshInMs?: number) {
    // Keep the account shell/refresh token independently of permission to fetch data.
    const canQuery = eligible(session) && (session.decodedToken.exp ?? 0) > Date.now();
    const changed =
      identity(session) !== identity(this.snapshot.session) || canQuery !== this.snapshot.canQuery;
    if (changed) {
      this.dataController.abort();
      this.dataController = new AbortController();
      clearPrivateQueries(this.queries);
    }
    this.snapshot = {
      session: eligible(session) ? session : null,
      canQuery,
      ready,
      notice,
      generation: this.snapshot.generation + (changed ? 1 : 0),
    };
    clearTimeout(this.refreshTimer);
    clearTimeout(this.expiryTimer);
    if (this.running && canQuery) {
      // Refresh may still be in flight (or the browser offline) at expiry. Do not
      // leave an expired JWT authorized until its transport timeout fires.
      this.expiryTimer = setTimeout(
        () => {
          this.emit(
            session,
            true,
            "Reconnecting your session. Private data is paused; we’ll retry automatically.",
          );
          void this.refresh();
        },
        (session.decodedToken.exp ?? Date.now()) - Date.now(),
      );
    }
    if (
      this.running &&
      session?.decodedToken.exp &&
      navigator.onLine &&
      document.visibilityState === "visible"
    ) {
      this.refreshTimer = setTimeout(
        () => void this.refresh(),
        refreshInMs ?? Math.max(10_000, session.decodedToken.exp - Date.now() - 60_000),
      );
    }
    for (const listener of this.listeners) listener();
  }
  private cancel() {
    this.epoch++;
    for (const request of this.pending) request.abort();
    this.pending.clear();
    this.refreshTask = undefined;
  }
  private withSessionLock(action: () => Promise<void>) {
    return navigator.locks
      ? navigator.locks.request("nhostSessionLock", { mode: "exclusive" }, action)
      : action();
  }
  private async operation<T>(action: (signal: AbortSignal) => Promise<T>) {
    if (this.signingOut) throw new DOMException("Signing out", "AbortError");
    const epoch = this.epoch;
    const controller = new AbortController();
    this.pending.add(controller);
    try {
      const result = await action(
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      );
      if (epoch !== this.epoch) throw new DOMException("Authentication changed", "AbortError");
      return result;
    } finally {
      this.pending.delete(controller);
    }
  }
  start() {
    this.running = true;
    const unsubscribe = this.client.sessionStorage.onChange((session) => {
      if (!this.signingOut || !session) {
        if (!this.signingOut && identity(session) !== identity(this.snapshot.session))
          this.cancel();
        this.emit(session);
      }
    });
    const sync = (event: StorageEvent) => {
      if (this.signingOut || (event.key !== "nhostSession" && event.key !== null)) return;
      this.cancel();
      // A token rotation in another tab is already checked. Do not refresh it again
      // (that would create a storage-event refresh ping-pong).
      this.emit(this.client.getUserSession());
    };
    const focus = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void this.refresh();
      else clearTimeout(this.refreshTimer);
    };
    window.addEventListener("storage", sync);
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    window.addEventListener("offline", focus);
    document.addEventListener("visibilitychange", focus);
    void this.refresh();
    return () => {
      unsubscribe();
      this.running = false;
      clearTimeout(this.refreshTimer);
      clearTimeout(this.expiryTimer);
      this.cancel();
      this.dataController.abort();
      this.dataController = new AbortController();
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      window.removeEventListener("offline", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }
  async refresh() {
    if (this.signingOut) return;
    if (this.refreshTask) return this.refreshTask;
    if (!navigator.onLine || document.visibilityState !== "visible") {
      this.emit(
        this.client.getUserSession(),
        true,
        "Session checks are paused until this browser is online and visible.",
      );
      return;
    }
    const epoch = this.epoch;
    // Keep persistence and failure handling inside the lock too: a waiting signout
    // must see (and revoke) the latest rotated token, not the pre-refresh token.
    const task = this.withSessionLock(async () => {
      if (epoch !== this.epoch) return;
      const session = this.client.getUserSession();
      if (!session) {
        this.emit(null);
        return;
      }
      try {
        const response = await this.operation((signal) =>
          this.client.auth.refreshToken({ refreshToken: session.refreshToken }, { signal }),
        );
        if (epoch === this.epoch) {
          this.refreshBackoffMs = 1000;
          this.client.sessionStorage.set(response.body);
          if (!eligible(this.client.getUserSession())) this.client.clearSession();
        }
      } catch (error) {
        if (epoch !== this.epoch || (error as Error).name === "AbortError") return;
        const current = this.client.getUserSession();
        if ((error as { status?: number }).status === 401 || !eligible(current)) {
          this.client.clearSession();
          this.emit(null, true, "Your session expired. Reconnect and sign in again.");
        } else {
          // A transport/service failure does not invalidate the stored refresh token,
          // even after the access token expires. Only 401/eligibility loss forget it.
          const remainingMs = (current.decodedToken.exp ?? 0) - Date.now();
          const retryInMs = this.refreshBackoffMs;
          this.refreshBackoffMs = Math.min(10_000, retryInMs * 2);
          this.emit(
            current,
            true,
            remainingMs > 0
              ? "Your session couldn’t be checked. We’ll retry automatically; you can keep working until it expires."
              : "Reconnecting your session. Private data is paused; we’ll retry automatically.",
            remainingMs > 0 ? Math.min(retryInMs, remainingMs) : retryInMs,
          );
        }
      }
    });
    this.refreshTask = task;
    try {
      await task;
    } finally {
      if (this.refreshTask === task) this.refreshTask = undefined;
    }
  }
  async sendCode(email: string, signup: boolean) {
    if (!companyEmail(email)) throw new Error("Use your exact @nhost.io email address.");
    await this.operation((signal) =>
      signup
        ? this.client.auth.signUpOTPEmail({ email: normalizeEmail(email) }, { signal })
        : this.client.auth.signInOTPEmail({ email: normalizeEmail(email) }, { signal }),
    );
  }
  async verify(email: string, otp: string) {
    const epoch = this.epoch;
    const response = await this.operation((signal) =>
      this.client.auth.verifySignInOTPEmail(
        { email: normalizeEmail(email), otp: otp.trim() },
        { signal },
      ),
    );
    if (epoch !== this.epoch) throw new DOMException("Authentication changed", "AbortError");
    if (!response.body.session) throw { status: 401 };
    this.client.sessionStorage.set(response.body.session);
    if (!eligible(this.client.getUserSession())) {
      this.client.clearSession();
      throw { status: 403 };
    }
  }
  async signOut() {
    if (this.signOutTask) return this.signOutTask;
    const initialSession = this.client.getUserSession();
    this.cancel();
    const epoch = this.epoch;
    this.signingOut = true;
    // Hide access immediately, including rotations observed while waiting for the lock.
    this.client.clearSession();
    clearPrivateQueries(this.queries);
    const task = this.withSessionLock(async () => {
      const session = this.client.getUserSession() ?? initialSession;
      this.client.clearSession();
      if (session)
        await this.client.auth.signOut(
          { refreshToken: session.refreshToken },
          { signal: AbortSignal.timeout(8000) },
        );
    });
    this.signOutTask = task;
    try {
      await task;
    } catch {
      if (epoch === this.epoch && !this.client.getUserSession())
        this.emit(
          null,
          true,
          "Signed out on this browser. Server sign-out couldn’t be confirmed; close shared browsers.",
        );
    } finally {
      this.signingOut = false;
      this.signOutTask = undefined;
    }
  }
}
