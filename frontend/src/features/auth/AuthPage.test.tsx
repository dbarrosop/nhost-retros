import { createNhostClient } from "@nhost/nhost-js";
import { MemoryStorage } from "@nhost/nhost-js/session";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../lib/auth";
import { AuthStore } from "../../lib/auth-store";
import { createQueryClient } from "../../lib/query-client";
import { createAppRouter } from "../../router";

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
describe("company email forms", () => {
  it("guards the workspace and gives signup and sign-in separate entry points", async () => {
    const user = userEvent.setup();
    const { store } = setup("/workspace");
    await screen.findByRole("heading", { name: "Welcome back" });
    const send = vi.spyOn(store, "sendCode").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByRole("heading", { name: "Create your account" });
    await user.type(screen.getByLabelText("Company email"), "Person@NHOST.IO");
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
    expect(screen.getByLabelText("Company email")).toHaveValue("person@nhost.io");
  });
  it("rejects non-company domains before requests and sanitizes throttled sends", async () => {
    const user = userEvent.setup();
    const { store } = setup();
    await screen.findByRole("heading", { name: "Welcome back" });
    const send = vi
      .spyOn(store, "sendCode")
      .mockRejectedValue({ status: 429, body: "private backend internals" });
    const email = screen.getByLabelText("Company email");
    await user.type(email, "outside@sub.nhost.io");
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("exact @nhost.io");
    await user.clear(email);
    await user.type(email, "inside@nhost.io");
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
    expect(screen.queryByText("private backend internals")).not.toBeInTheDocument();
  });
});
