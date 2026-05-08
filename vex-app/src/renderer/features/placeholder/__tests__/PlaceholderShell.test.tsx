/**
 * PlaceholderShell sanity test: the M2-M15 roadmap is the user-facing
 * statement of where Phase 1 stands. Regressions on roadmap text or
 * status badges would mislead testers running unsigned dev builds.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PlaceholderShell } from "../PlaceholderShell.js";

describe("PlaceholderShell", () => {
  afterEach(cleanup);

  it("renders the Vex avatar and roadmap entries", () => {
    const { container, getByText } = render(<PlaceholderShell />);

    const avatar = container.querySelector('img[src="/vex.jpg"]');
    expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute("alt")).toBe("Vex avatar");

    expect(getByText("Phase 1 milestone roadmap")).toBeDefined();
    expect(getByText("M0")).toBeDefined();
    expect(getByText("M1")).toBeDefined();
    expect(getByText("M15")).toBeDefined();

    expect(getByText("Security baseline")).toBeDefined();
    expect(getByText("Brand splash + renderer infra")).toBeDefined();

    // Status badges
    expect(getByText("done")).toBeDefined();
    expect(getByText("in progress")).toBeDefined();
  });
});
