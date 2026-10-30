import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "./router";

function renderRoute(path = "/") {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(history);
  render(<RouterProvider router={router} />);
  return router;
}

describe("welcome workspace", () => {
  it("renders the welcome route with reflection prompts, not pretend session data or controls", async () => {
    renderRoute();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Make space for better work." }),
    ).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    const prompts = screen.getByRole("complementary", { name: "A few reflection prompts" });
    expect(within(prompts).getByText(/What gave you/)).toBeVisible();
    expect(within(prompts).getByText(/What would make/)).toBeVisible();
    expect(
      screen.getByText("For verified @nhost.io accounts. A one-time code is all you need."),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("offers working in-page navigation and a keyboard-first skip link", async () => {
    const user = userEvent.setup();
    const router = renderRoute();
    await screen.findByRole("heading", { level: 1 });
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("link", { name: "What to expect" })).toHaveAttribute(
      "href",
      "#how-it-works",
    );
    expect(
      screen.getByRole("region", { name: "Less ceremony. More understanding." }),
    ).toHaveAttribute("id", "how-it-works");
    await user.click(screen.getByRole("link", { name: "The approach" }));
    expect(router.state.location.hash).toBe("how-it-works");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("provides a route back home for an unknown address", async () => {
    const user = userEvent.setup();
    renderRoute("/not-a-page");
    expect(await screen.findByRole("heading", { name: "This page isn’t here." })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Back to welcome" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Make space for better work." }),
    ).toBeVisible();
  });
});
