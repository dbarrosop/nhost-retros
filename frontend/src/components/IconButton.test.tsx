import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton";

describe("compact action buttons", () => {
  it.each(["edit", "delete", "end", "close", "board"] as const)(
    "keeps the %s icon named, keyboard-accessible and ref-forwarding",
    async (icon) => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      const ref = createRef<HTMLButtonElement>();
      const label = `${icon} action`;
      const view = render(<IconButton ref={ref} label={label} icon={icon} onClick={onClick} />);
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("title", label);
      expect(button).toHaveAttribute("type", "button");
      expect(within(button).getByText(label)).toHaveClass("sr-only");
      expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(ref.current).toBe(button);
      await user.tab();
      expect(button).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(onClick).toHaveBeenCalledOnce();
      view.rerender(<IconButton ref={ref} label={label} icon={icon} onClick={onClick} disabled />);
      await user.click(button);
      expect(onClick).toHaveBeenCalledOnce();
    },
  );
});
