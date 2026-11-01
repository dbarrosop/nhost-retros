import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisclosureChevron } from "./DisclosureChevron";

describe("shared disclosure chevron", () => {
  it("stays decorative and supports positioning without changing the icon", () => {
    const { container } = render(<DisclosureChevron className="picker-position" />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveClass("disclosure-chevron", "picker-position");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("focusable", "false");
    expect(icon).toHaveAttribute("width", "16");
    expect(icon).toHaveAttribute("height", "16");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(icon?.textContent).toBe("");
  });
});
