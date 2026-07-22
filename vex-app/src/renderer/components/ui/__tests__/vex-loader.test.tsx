/**
 * Smoke pins for the VEX LOADER (the brand loader that replaced the
 * DotMatrix grid on setup surfaces — Chronos Gate PR1):
 *  - announces its label once via role="status" (a11y contract);
 *  - tone maps to the paper/ink CSS class pair;
 *  - the center slot renders children only when provided (ring-only
 *    inline variant stays canvas-free).
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VexLoader } from "../vex-loader.js";

describe("VexLoader", () => {
  it("announces the label via role=status and defaults to the ink tone", () => {
    render(<VexLoader label="Waking the desk" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Waking the desk");
    expect(status.className).toContain("vex-loader--ink");
    expect(status.getAttribute("data-vex-loader")).toBe("ink");
  });

  it("paper tone maps to the paper class", () => {
    render(<VexLoader label="Loading" tone="paper" />);
    expect(screen.getByRole("status").className).toContain(
      "vex-loader--paper",
    );
  });

  it("renders center content only when children are provided", () => {
    const { rerender } = render(<VexLoader label="Loading" />);
    expect(
      screen.getByRole("status").querySelector("[aria-hidden]"),
    ).toBeNull();
    rerender(
      <VexLoader label="Loading">
        <span data-testid="center-mark" />
      </VexLoader>,
    );
    expect(screen.getByTestId("center-mark")).toBeTruthy();
  });
});
