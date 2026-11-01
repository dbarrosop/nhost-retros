import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmAction, TextForm } from "./controls";

describe("keyboard-safe content controls", () => {
  it("focuses an opened editor without stealing focus on later renders", async () => {
    const user = userEvent.setup();
    const props = {
      label: "Edit question",
      maximum: 500,
      submit: "Save",
      focusOnMount: true,
      onSave: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(<TextForm {...props} />);
    const input = screen.getByLabelText("Edit question", { exact: true });
    expect(input).toHaveFocus();
    await user.type(input, "A clearer question");
    await user.tab();
    const submit = screen.getByRole("button", { name: "Save" });
    expect(submit).toHaveFocus();
    view.rerender(<TextForm {...props} />);
    expect(submit).toHaveFocus();
  });

  it.each([false, true])(
    "keeps submit focus and guards pending writes (failure: %s)",
    async (fails) => {
      let resolve!: () => void;
      let reject!: () => void;
      const save = vi.fn(
        () =>
          new Promise<void>((done, fail) => {
            resolve = done;
            reject = () => fail(new Error("test failure"));
          }),
      );
      const user = userEvent.setup();
      render(
        <TextForm label="New card" maximum={4000} submit="Add card" multiline onSave={save} />,
      );
      const input = screen.getByLabelText("New card", { exact: true });
      const submit = screen.getByRole("button", { name: "Add card" });
      await user.type(input, "A thought worth keeping");
      await user.tab();
      await user.keyboard("{Enter}");
      expect(submit).toHaveFocus();
      expect(submit).toHaveAttribute("aria-disabled", "true");
      expect(input).toHaveAttribute("readonly");
      expect(input).toBeEnabled();
      await user.keyboard("{Enter}");
      const form = input.closest("form");
      expect(form).not.toBeNull();
      if (form) fireEvent.submit(form);
      expect(save).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (fails) reject();
        else resolve();
      });
      await waitFor(() => expect(submit).toHaveAttribute("aria-disabled", "false"));
      expect(submit).toHaveFocus();
      expect(input).not.toHaveAttribute("readonly");
      expect(input).toHaveValue(fails ? "A thought worth keeping" : "");
      if (fails) expect(screen.getByRole("alert")).toHaveTextContent("This change wasn’t saved");
    },
  );

  it("runs post-confirm focus only after the native modal closes", async () => {
    const user = userEvent.setup();
    const afterConfirm = vi.fn(() => {
      expect(dialog.open).toBe(false);
      screen.getByRole("heading", { name: "Your cards" }).focus();
    });
    render(
      <>
        <h2 tabIndex={-1}>Your cards</h2>
        <ConfirmAction
          label="Delete card"
          title="Delete your card?"
          description="This cannot be undone."
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          afterConfirm={afterConfirm}
        />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Delete card" }));
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    await user.click(within(dialog).getByRole("button", { name: "Delete card" }));
    await waitFor(() => expect(afterConfirm).toHaveBeenCalledOnce());
    expect(screen.getByRole("heading", { name: "Your cards" })).toHaveFocus();
  });

  it("keeps failed confirmation open and restores trigger focus on Cancel or Escape", async () => {
    const user = userEvent.setup();
    const afterConfirm = vi.fn();
    render(
      <ConfirmAction
        label="Delete card"
        title="Delete your card?"
        description="This cannot be undone."
        icon="delete"
        onConfirm={vi.fn().mockRejectedValue(new Error("test failure"))}
        afterConfirm={afterConfirm}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Delete card" });
    await user.click(trigger);
    let dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete card" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This change wasn’t saved");
    expect(dialog).toHaveAttribute("open");
    expect(afterConfirm).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(afterConfirm).not.toHaveBeenCalled();
  });
});
