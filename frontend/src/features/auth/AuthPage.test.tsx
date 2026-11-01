import { createNhostClient } from "@nhost/nhost-js";
import type { Session } from "@nhost/nhost-js/auth";
import { MemoryStorage } from "@nhost/nhost-js/session";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../lib/auth";
import { AuthStore } from "../../lib/auth-store";
import { createQueryClient } from "../../lib/query-client";
import { createAppRouter } from "../../router";

function facilitatorSession(): Session {
  return {
    accessToken: `e30.${btoa(JSON.stringify({ sub: "facilitator", exp: Date.now() / 1000 + 900 }))}.test`,
    accessTokenExpiresIn: 900,
    refreshToken: "synthetic-refresh-token",
    refreshTokenId: "synthetic-refresh-token-id",
    user: {
      id: "facilitator",
      email: "facilitator@nhost.io",
      emailVerified: true,
      isAnonymous: false,
      defaultRole: "facilitator",
      roles: ["user", "me", "facilitator"],
      displayName: "Test facilitator",
      locale: "en",
      avatarUrl: "",
      createdAt: "",
      phoneNumberVerified: false,
      metadata: {},
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(path = "/auth") {
  const client = createNhostClient({ storage: new MemoryStorage() });
  const queries = createQueryClient();
  const store = new AuthStore(client, queries);
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queries}>
      <AuthProvider store={store}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { store, client };
}
describe("email OTP forms", () => {
  it("guards the workspace and gives signup and sign-in separate entry points", async () => {
    const user = userEvent.setup();
    const { store } = setup("/workspace");
    await screen.findByRole("heading", { name: "Welcome back" });
    const send = vi.spyOn(store, "sendCode").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByRole("heading", { name: "Create your account" });
    await user.type(screen.getByLabelText("Email"), "Person@NHOST.IO");
    await user.click(screen.getByRole("button", { name: "Create account & send code" }));
    expect(send).toHaveBeenCalledWith("Person@NHOST.IO", true);
    expect(await screen.findByLabelText("One-time code")).toHaveFocus();
    expect(screen.getByRole("button", { name: /Resend code in/ })).toBeDisabled();
    const verify = vi.spyOn(store, "verify").mockRejectedValue({ status: 400 });
    await user.type(screen.getByLabelText("One-time code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(verify).toHaveBeenCalledWith("person@nhost.io", "123456");
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid, expired or already used");
    expect(screen.getByLabelText("One-time code")).toHaveValue("123456");
    await user.click(screen.getByRole("button", { name: "Use another email" }));
    expect(screen.getByLabelText("Email")).toHaveValue("person@nhost.io");
  });
  it("enters the workspace after successful OTP verification with a facilitator default role", async () => {
    const user = userEvent.setup();
    const { store, client } = setup();
    const session = facilitatorSession();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { retroSessions: [] } }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.spyOn(store, "sendCode").mockResolvedValue();
    vi.spyOn(client.auth, "verifySignInOTPEmail").mockResolvedValue({
      body: { session },
      status: 200,
      headers: new Headers(),
    });
    vi.spyOn(client.auth, "refreshToken").mockResolvedValue({
      body: session,
      status: 200,
      headers: new Headers(),
    });
    await screen.findByRole("heading", { name: "Welcome back" });
    await user.type(screen.getByLabelText("Email"), "facilitator@nhost.io");
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    await user.type(await screen.findByLabelText("One-time code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and continue" }));
    const view = await screen.findByText("Participant view", { selector: "summary" });
    expect(view).toBeVisible();
    await user.click(view);
    expect(screen.getByRole("link", { name: "Facilitator view" })).toBeVisible();
    expect(store.getSnapshot().canQuery).toBe(true);
    expect(store.getSnapshot().session?.user?.defaultRole).toBe("facilitator");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/default role remains participant/)).not.toBeInTheDocument();
  });
  it("does not describe a verified but ineligible account as an invalid code", async () => {
    const user = userEvent.setup();
    const { store } = setup();
    vi.spyOn(store, "sendCode").mockResolvedValue();
    vi.spyOn(store, "verify").mockRejectedValue({ status: 403, code: "ineligible-session" });
    await screen.findByRole("heading", { name: "Welcome back" });
    await user.type(screen.getByLabelText("Email"), "participant@nhost.io");
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    await user.type(await screen.findByLabelText("One-time code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and continue" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your account doesn’t have access");
    expect(alert).not.toHaveTextContent("code is invalid");
    expect(screen.getByLabelText("One-time code")).toHaveValue("123456");
  });
  it("accepts arbitrary email domains and sanitizes throttled sends", async () => {
    const user = userEvent.setup();
    const { store } = setup();
    await screen.findByRole("heading", { name: "Welcome back" });
    const send = vi
      .spyOn(store, "sendCode")
      .mockRejectedValue({ status: 429, body: "private backend internals" });
    const email = screen.getByLabelText("Email");
    for (const address of [
      "outside@sub.nhost.io",
      "person@example.com",
      "facilitator@acme.local",
    ]) {
      await user.clear(email);
      await user.type(email, address);
      await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
      expect(send).toHaveBeenLastCalledWith(address, false);
      expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
    }
    expect(screen.queryByText("private backend internals")).not.toBeInTheDocument();
  });
});
