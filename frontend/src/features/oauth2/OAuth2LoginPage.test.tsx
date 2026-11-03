import { createNhostClient } from "@nhost/nhost-js";
import type { Session } from "@nhost/nhost-js/auth";
import { MemoryStorage } from "@nhost/nhost-js/session";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../lib/auth";
import { AuthStore } from "../../lib/auth-store";
import { createQueryClient } from "../../lib/query-client";
import { createAppRouter } from "../../router";

const requestId = "550e8400-e29b-41d4-a716-446655440000";
const otherRequestId = "550e8400-e29b-41d4-a716-446655440001";
const request = {
  requestId,
  clientId: "nhoa_test_application",
  scopes: ["openid", "profile", "email", "graphql:role:user", "custom:read"],
  redirectUri: "https://client.example/callback",
};
const redirectUri = `${request.redirectUri}?code=one-time&state=original%2Bstate&iss=https%3A%2F%2Fauth.example%2Fv1`;
const path = `/oauth2/login?request_id=${requestId}`;
const response = <T,>(body: T) => ({ body, status: 200, headers: new Headers() });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function session(): Session {
  return {
    accessToken: `e30.${btoa(JSON.stringify({ sub: "user", exp: Date.now() / 1000 + 900 }))}.test`,
    accessTokenExpiresIn: 900,
    refreshToken: "synthetic-refresh-token",
    refreshTokenId: "synthetic-refresh-token-id",
    user: {
      id: "user",
      email: "person@example.com",
      emailVerified: true,
      isAnonymous: false,
      defaultRole: "user",
      roles: ["user", "me"],
      displayName: "Test person",
      locale: "en",
      avatarUrl: "",
      createdAt: "",
      phoneNumberVerified: false,
      metadata: {},
    },
  };
}

function setup({
  signedIn = true,
  entry = path,
  prepare,
}: {
  signedIn?: boolean;
  entry?: string;
  prepare?: (client: ReturnType<typeof createNhostClient>) => void;
} = {}) {
  const client = createNhostClient({ storage: new MemoryStorage(), configure: [] });
  const queries = createQueryClient();
  const store = new AuthStore(client, queries);
  const activeSession = session();
  vi.spyOn(client.auth, "refreshToken").mockResolvedValue(response(activeSession));
  vi.spyOn(client.auth, "signOut").mockResolvedValue(response("OK"));
  const get = vi.spyOn(client.auth, "oauth2LoginGet").mockResolvedValue(response(request));
  const post = vi
    .spyOn(client.auth, "oauth2LoginPost")
    .mockResolvedValue(response({ redirectUri }));
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  if (signedIn) client.sessionStorage.set(activeSession);
  prepare?.(client);
  const router = createAppRouter(createMemoryHistory({ initialEntries: [entry] }));
  render(
    <QueryClientProvider client={queries}>
      <AuthProvider store={store}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { client, store, get, post, assign, router };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OAuth2 login and consent", () => {
  it.each(["/oauth2/login", "/oauth2/login?request_id=bad", "/oauth2/login?request_id=123"])(
    "rejects missing or malformed request IDs without contacting OAuth2: %s",
    async (entry) => {
      const { get, post } = setup({ entry });
      expect(
        await screen.findByRole("heading", { name: "Invalid authorization request" }),
      ).toBeVisible();
      expect(get).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    },
  );

  it("shows only Auth's client, callback and scopes and never automatically approves an existing session", async () => {
    const { get, post, assign, store } = setup({
      entry: `${path}&client_id=evil&scope=evil&redirect_uri=https://evil.example`,
      prepare: (client) => {
        // Keep approval disabled until the expired stored session can be renewed.
        client.sessionStorage.set({
          ...session(),
          accessToken: `e30.${btoa(JSON.stringify({ sub: "user", exp: Date.now() / 1000 - 60 }))}.test`,
        });
        vi.mocked(client.auth.refreshToken).mockRejectedValueOnce({ status: 503 });
      },
    });
    expect(await screen.findByRole("heading", { name: "Authorize application" })).toBeVisible();
    expect(get).toHaveBeenCalledWith(
      { request_id: requestId },
      expect.objectContaining({ signal: expect.any(AbortSignal), cache: "no-store" }),
    );
    expect(screen.getByText(request.clientId)).toBeVisible();
    expect(screen.getByText(request.redirectUri)).toBeVisible();
    expect(within(screen.getByRole("main")).getByText("person@example.com")).toBeVisible();
    expect(screen.getByText("custom:read")).toBeVisible();
    expect(screen.getByText(/“user” role/)).toBeVisible();
    expect(screen.queryByText("evil")).not.toBeInTheDocument();
    expect(screen.queryByText("offline_access")).not.toBeInTheDocument();
    const allow = screen.getByRole("button", { name: "Allow access" });
    expect(allow).toBeDisabled();
    expect(
      screen.getByText(
        /keep and renew access in the background even when you are not using it, whether or not it requests offline_access/,
      ),
    ).toBeVisible();
    await act(() => store.refresh());
    expect(screen.getByRole("button", { name: "Allow access" })).toBeEnabled();
    expect(post).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("posts explicit consent once with the current Bearer token and follows Auth's exact redirect", async () => {
    const pending = deferred<ReturnType<typeof response<{ redirectUri: string }>>>();
    const { post, assign, store } = setup({
      prepare: (client) => {
        vi.mocked(client.auth.oauth2LoginPost).mockReturnValue(pending.promise);
      },
    });
    const user = userEvent.setup();
    const allow = await screen.findByRole("button", { name: "Allow access" });
    await user.dblClick(allow);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      { requestId },
      expect.objectContaining({
        headers: { Authorization: `Bearer ${store.getSnapshot().session?.accessToken}` },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => pending.resolve(response({ redirectUri })));
    expect(assign).toHaveBeenCalledExactlyOnceWith(redirectUri);
  });

  it("signs in with email OTP in place, keeping the request and requiring separate approval", async () => {
    const { store, client, post, get, router } = setup({ signedIn: false });
    vi.spyOn(store, "sendCode").mockResolvedValue();
    vi.spyOn(client.auth, "verifySignInOTPEmail").mockResolvedValue(
      response({ session: session() }),
    );
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Welcome back" });
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    await user.type(await screen.findByLabelText("One-time code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("button", { name: "Allow access" })).toBeEnabled();
    expect(router.state.location.pathname).toBe("/oauth2/login");
    expect(router.state.location.search).toEqual({ request_id: requestId });
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Allow access" }));
    expect(post).toHaveBeenCalledWith({ requestId }, expect.anything());
  });

  it.each([true, false])(
    "cancels without granting access or signing out (signed in: %s)",
    async (signedIn) => {
      const { post, assign, store } = setup({ signedIn });
      const user = userEvent.setup();
      await screen.findByRole("heading", {
        name: signedIn ? "Authorize application" : "Welcome back",
      });
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await screen.findByRole("heading", { name: "Access not granted" })).toBeVisible();
      expect(post).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
      expect(Boolean(store.getSnapshot().session)).toBe(signedIn);
    },
  );

  it("lets the user switch accounts without losing the request", async () => {
    const { post, get, router } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Use another account" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(router.state.location.search).toEqual({ request_id: requestId });
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("sanitizes transient load failures and allows retrying", async () => {
    const { get, post } = setup({
      prepare: (client) => {
        vi.mocked(client.auth.oauth2LoginGet).mockRejectedValueOnce({
          status: 503,
          body: "private internals",
        });
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t load this request");
    expect(screen.queryByText("private internals")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow access" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Allow access" })).toBeEnabled();
    expect(get).toHaveBeenCalledTimes(2);
    expect(post).not.toHaveBeenCalled();
  });

  it("handles expired requests without showing a sign-in or approval form", async () => {
    setup({
      prepare: (client) => {
        vi.mocked(client.auth.oauth2LoginGet).mockRejectedValue({
          status: 400,
          body: "private internals",
        });
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid, expired or already used");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow access" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("handles a request expiring at approval without redirecting or leaking backend errors", async () => {
    const { post, assign } = setup({
      prepare: (client) => {
        vi.mocked(client.auth.oauth2LoginPost).mockRejectedValue({
          status: 400,
          body: "private internals",
        });
      },
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Allow access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid, expired or already used");
    expect(screen.getByRole("button", { name: "Allow access" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("does not redirect a late approval after signout", async () => {
    const pending = deferred<ReturnType<typeof response<{ redirectUri: string }>>>();
    const { client, assign, post } = setup({
      prepare: (client) => {
        vi.mocked(client.auth.oauth2LoginPost).mockReturnValue(pending.promise);
      },
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Allow access" }));
    const options = post.mock.calls[0]?.[1];
    act(() => client.clearSession());
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(response({ redirectUri })));
    expect(assign).not.toHaveBeenCalled();
  });

  it("ignores old request metadata when the request_id changes", async () => {
    const pending = deferred<ReturnType<typeof response<typeof request>>>();
    const { router, get } = setup({
      prepare: (client) => {
        vi.mocked(client.auth.oauth2LoginGet)
          .mockReturnValueOnce(pending.promise)
          .mockResolvedValue(
            response({
              ...request,
              requestId: otherRequestId,
              clientId: "nhoa_second_application",
            }),
          );
      },
    });
    await screen.findByText("Loading authorization request…");
    await act(async () =>
      router.navigate({ to: "/oauth2/login", search: { request_id: otherRequestId } }),
    );
    expect(await screen.findByText("nhoa_second_application")).toBeVisible();
    expect(get.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(response(request)));
    expect(screen.queryByText(request.clientId)).not.toBeInTheDocument();
  });

  it("blocks script and mismatched callback responses", async () => {
    const { assign } = setup({
      prepare: (client) => {
        vi.mocked(client.auth.oauth2LoginPost).mockResolvedValue(
          response({ redirectUri: "javascript:alert(1)" }),
        );
      },
    });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Allow access" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t complete authorization"),
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
