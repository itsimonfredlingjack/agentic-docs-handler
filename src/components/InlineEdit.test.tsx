import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { InlineEdit } from "./InlineEdit";

describe("InlineEdit", () => {
  it("renders value as text by default", () => {
    render(<InlineEdit value="Telia" onSave={vi.fn()} />);
    expect(screen.getByText("Telia")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("switches to input on click", async () => {
    const user = userEvent.setup();
    render(<InlineEdit value="Telia" onSave={vi.fn()} />);
    await user.click(screen.getByText("Telia"));
    expect(screen.getByRole("textbox")).toHaveValue("Telia");
  });

  it("calls onSave on Enter and exits edit mode", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEdit value="Telia" onSave={onSave} />);
    await user.click(screen.getByText("Telia"));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Tele2{Enter}");
    expect(onSave).toHaveBeenCalledWith("Tele2");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("reverts on Escape", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEdit value="Telia" onSave={onSave} />);
    await user.click(screen.getByText("Telia"));
    await user.type(screen.getByRole("textbox"), "wrong");
    await user.keyboard("{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Telia")).toBeInTheDocument();
  });
});
