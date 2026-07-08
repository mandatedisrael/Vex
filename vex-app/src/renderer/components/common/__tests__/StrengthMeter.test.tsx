/**
 * StrengthMeter — presentational-only (no zxcvbn calls here; see
 * `wizard/steps/keystore/useMasterPasswordStrength.test.ts` for the real
 * estimator behavior). Verifies label text, the "Checking…" not-ready
 * override, and that feedback only renders while `blocked` is true.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StrengthMeter } from "../StrengthMeter.js";

afterEach(() => {
  cleanup();
});

describe("StrengthMeter", () => {
  it("renders the weak/fair/good/strong label text", () => {
    for (const label of ["weak", "fair", "good", "strong"] as const) {
      const { getByText, unmount } = render(
        <StrengthMeter
          length={10}
          ready
          score={0}
          label={label}
          blocked={label === "weak" || label === "fair"}
        />
      );
      expect(
        getByText(new RegExp(`^${label}$`, "i"))
      ).toBeTruthy();
      unmount();
    }
  });

  it("shows 'Checking…' instead of the label while not ready and the field is non-empty", () => {
    const { getByText, queryByText } = render(
      <StrengthMeter length={5} ready={false} score={0} label="weak" blocked />
    );
    expect(getByText(/Checking…/i)).toBeTruthy();
    expect(queryByText(/^weak$/i)).toBeNull();
  });

  it("does not show 'Checking…' when the field is empty, even if not ready", () => {
    const { queryByText } = render(
      <StrengthMeter length={0} ready={false} score={0} label="weak" blocked />
    );
    expect(queryByText(/Checking…/i)).toBeNull();
  });

  it("shows the zxcvbn warning text when blocked", () => {
    const { getByText } = render(
      <StrengthMeter
        length={11}
        ready
        score={0}
        label="weak"
        blocked
        warning="This is a commonly used password."
        suggestions={["Add more words that are less common."]}
      />
    );
    expect(getByText(/commonly used password/i)).toBeTruthy();
  });

  it("falls back to the first suggestion when there is no warning", () => {
    const { getByText } = render(
      <StrengthMeter
        length={11}
        ready
        score={1}
        label="weak"
        blocked
        warning={null}
        suggestions={["Add more words that are less common."]}
      />
    );
    expect(getByText(/add more words/i)).toBeTruthy();
  });

  it("shows no feedback text once the password meets the gate (blocked=false)", () => {
    const { queryByText } = render(
      <StrengthMeter
        length={32}
        ready
        score={4}
        label="strong"
        blocked={false}
        warning={null}
        suggestions={[]}
      />
    );
    expect(queryByText(/add more words|commonly used/i)).toBeNull();
  });

  it("shows no feedback text for an empty field even if blocked is true", () => {
    const { queryByText } = render(
      <StrengthMeter
        length={0}
        ready
        score={0}
        label="weak"
        blocked
        warning="should not show"
      />
    );
    expect(queryByText(/should not show/i)).toBeNull();
  });
});
