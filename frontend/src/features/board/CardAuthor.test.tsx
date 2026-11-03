import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CardAuthor } from "./CardAuthor";

describe("compact card author", () => {
  it("shows only the number and avatar until the author is hovered", async () => {
    const user = userEvent.setup();
    render(<CardAuthor number={1} name="Alice Chen" email="alice@example.com" />);
    const avatar = screen.getByRole("button", {
      name: "Author of card 1: Alice Chen (alice@example.com)",
    });
    expect(screen.getByText("01")).toBeVisible();
    expect(within(avatar).getByText("AC")).toBeVisible();
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
    await user.hover(avatar);
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("Alice Chen")).toBeVisible();
    expect(within(tooltip).getByText("alice@example.com")).toBeVisible();
    // Model the related targets explicitly: jsdom cannot hit-test the floating tooltip.
    fireEvent.mouseOut(avatar, { relatedTarget: tooltip });
    fireEvent.mouseOver(tooltip, { relatedTarget: avatar });
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.mouseOut(tooltip, { relatedTarget: document.body });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("supports keyboard focus and Escape without losing focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <CardAuthor number={2} name="Alice" email="alice@example.com" />
        <button type="button">Next control</button>
      </>,
    );
    const avatar = screen.getByRole("button", { name: /^Author of card 2:/ });
    await user.tab();
    expect(avatar).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveTextContent("alice@example.com");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(avatar).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Next control" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on pointer activation and dismisses on an outside press", async () => {
    const user = userEvent.setup();
    render(<CardAuthor number={1} name="Alice" email="alice@example.com" />);
    const avatar = screen.getByRole("button", { name: /^Author of card 1:/ });
    await user.click(avatar);
    expect(avatar).toHaveFocus();
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.click(document.body);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.click(avatar);
    expect(screen.getByRole("tooltip")).toBeVisible();
  });

  it("does not repeat an email-only name and supports former participants", async () => {
    const user = userEvent.setup();
    const view = render(
      <CardAuthor number={1} name="alice@example.com" email="alice@example.com" />,
    );
    await user.hover(screen.getByRole("button", { name: "Author of card 1: alice@example.com" }));
    expect(within(screen.getByRole("tooltip")).getAllByText("alice@example.com")).toHaveLength(1);
    view.rerender(<CardAuthor number={1} name="Former participant" />);
    expect(
      screen.getByRole("button", { name: "Author of card 1: Former participant" }),
    ).toBeVisible();
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
  });
});
