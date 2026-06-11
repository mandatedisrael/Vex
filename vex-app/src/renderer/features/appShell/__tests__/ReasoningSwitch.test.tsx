/**
 * REASON control (S6) — direct component pins: cycle order, aria contract,
 * the test hook (`data-vex-reasoning-effort`), and the real `disabled`
 * attribute while a turn is in flight. Visibility gating (hidden unless the
 * model supports reasoning) lives with the parent and is pinned in
 * `AppShell/composer-reasoning-switch.test.tsx`.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));
vi.mock("@hugeicons/core-free-icons", () => ({
  AiBrain05Icon: "AiBrain05Icon",
}));

const { ReasoningSwitch, nextReasoningEffort } = await import(
  "../ReasoningSwitch.js"
);

describe("nextReasoningEffort", () => {
  it("cycles low → medium → high → low", () => {
    expect(nextReasoningEffort("low")).toBe("medium");
    expect(nextReasoningEffort("medium")).toBe("high");
    expect(nextReasoningEffort("high")).toBe("low");
  });
});

describe("ReasoningSwitch", () => {
  it("renders the level with aria-label, title, and the data hook", () => {
    render(<ReasoningSwitch effort="medium" busy={false} onCycle={() => {}} />);
    const button = screen.getByRole("button", {
      name: "Reasoning effort: medium",
    });
    expect(button.getAttribute("data-vex-reasoning-effort")).toBe("medium");
    expect(button.getAttribute("title")).toContain("Reasoning effort: medium");
    expect(button.textContent).toContain("Reason · Med");
  });

  it("shows the short label for low and high", () => {
    const { rerender } = render(
      <ReasoningSwitch effort="low" busy={false} onCycle={() => {}} />,
    );
    expect(screen.getByRole("button").textContent).toContain("Reason · Low");
    rerender(<ReasoningSwitch effort="high" busy={false} onCycle={() => {}} />);
    expect(screen.getByRole("button").textContent).toContain("Reason · High");
    expect(
      screen.getByRole("button").getAttribute("data-vex-reasoning-effort"),
    ).toBe("high");
  });

  it("invokes onCycle on click", () => {
    const onCycle = vi.fn();
    render(<ReasoningSwitch effort="medium" busy={false} onCycle={onCycle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onCycle).toHaveBeenCalledTimes(1);
  });

  it("is truly disabled while a turn is in flight", () => {
    const onCycle = vi.fn();
    render(<ReasoningSwitch effort="medium" busy onCycle={onCycle} />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onCycle).not.toHaveBeenCalled();
  });
});
