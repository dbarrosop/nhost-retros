import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HeaderMenu } from "./HeaderMenu";

function setup() {
  const select = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <HeaderMenu className="test-menu" summary="Choose an option">
        {(close) => (
          <button
            type="button"
            onClick={() => {
              close();
              select();
            }}
          >
            <span>Second option</span>
          </button>
        )}
      </HeaderMenu>
      <button type="button">Outside focus target</button>
    </>,
  );
  return {
    select,
    user,
    trigger: screen.getByText("Choose an option", { selector: "summary" }),
    outside: screen.getByRole("button", { name: "Outside focus target" }),
    option: () => screen.getByRole("button", { name: "Second option" }),
  };
}

describe("header menu actions", () => {
  it("keeps an option mounted when focus leaves during pointer activation", async () => {
    const app = setup();
    await app.user.click(app.trigger);
    const option = app.option();
    fireEvent.pointerDown(option);
    app.outside.focus();
    expect(app.trigger.closest("details")).toHaveAttribute("open");
    expect(option).toBeVisible();
    fireEvent.pointerUp(option);
    await app.user.click(option);
    expect(app.select).toHaveBeenCalledOnce();
    expect(app.trigger.closest("details")).not.toHaveAttribute("open");
  });

  it("allows an action to dismiss explicitly without relying on link activation", async () => {
    const app = setup();
    await app.user.click(app.trigger);
    await app.user.click(within(app.option()).getByText("Second option"));
    expect(app.select).toHaveBeenCalledOnce();
    expect(app.trigger.closest("details")).not.toHaveAttribute("open");
    expect(app.trigger).toHaveFocus();
  });

  it("restores blur dismissal after a pointer gesture is cancelled", async () => {
    const app = setup();
    await app.user.click(app.trigger);
    fireEvent.pointerDown(app.option());
    fireEvent.pointerCancel(app.option());
    app.outside.focus();
    expect(app.trigger.closest("details")).not.toHaveAttribute("open");
    expect(app.select).not.toHaveBeenCalled();
  });

  it("dismisses a pointer gesture released outside without selecting an option", async () => {
    const app = setup();
    await app.user.click(app.trigger);
    fireEvent.pointerDown(app.option());
    fireEvent.pointerUp(app.outside);
    expect(app.trigger.closest("details")).not.toHaveAttribute("open");
    expect(app.select).not.toHaveBeenCalled();
  });

  it("keeps Tab dismissal working after a pointer press", async () => {
    const app = setup();
    await app.user.click(app.trigger);
    fireEvent.pointerDown(app.option());
    await app.user.tab();
    expect(app.option()).toHaveFocus();
    expect(app.trigger.closest("details")).toHaveAttribute("open");
    await app.user.tab();
    expect(app.outside).toHaveFocus();
    expect(app.trigger.closest("details")).not.toHaveAttribute("open");
    expect(app.select).not.toHaveBeenCalled();
  });
});
