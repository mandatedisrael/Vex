/**
 * PolymarketSudoModal — renderer parity for the feature #7 sudo flow.
 *
 * Mocks `window.vex.onboarding.polymarketAutoSetup` per skill §12.
 * Validates:
 *  - form gating (checkbox + min password length),
 *  - exact IPC invocation arguments (carries overwriteConfirmed prop),
 *  - per-error-code branches: password_invalid, keystore_locked,
 *    keystore_missing, risk_confirmation_required (race fallback),
 *    polymarket_setup_failed, provider.unavailable,
 *    onboarding.env_persist_failed,
 *  - success path → onSuccess(result) + onClose,
 *  - Cancel button calls onClose,
 *  - password input cleared synchronously before await.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Result } from "@shared/ipc/result.js";

interface PolymarketAutoSetupInput {
  readonly password: string;
  readonly riskAcknowledged: true;
  readonly overwriteConfirmed: boolean;
}

interface PolymarketAutoSetupResultShape {
  readonly configured: true;
  readonly address: string;
}

const mockAutoSetup = vi.fn<
  (input: PolymarketAutoSetupInput) => Promise<Result<PolymarketAutoSetupResultShape>>
>();
const mockOnClose = vi.fn();
const mockOnSuccess = vi.fn();
const mockOnRiskConfirmationRequired = vi.fn();

const { PolymarketSudoModal } = await import("../PolymarketSudoModal.js");

const VALID_PASSWORD = "valid-password-12";
const EVM_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

function renderModal(
  props?: Partial<{
    overwriteConfirmed: boolean;
    onSuccess: typeof mockOnSuccess;
    onClose: () => void;
    onRiskConfirmationRequired: typeof mockOnRiskConfirmationRequired;
  }>,
): ReturnType<typeof render> {
  return render(
    <PolymarketSudoModal
      overwriteConfirmed={props?.overwriteConfirmed ?? false}
      onSuccess={props?.onSuccess ?? mockOnSuccess}
      onClose={props?.onClose ?? mockOnClose}
      onRiskConfirmationRequired={
        props?.onRiskConfirmationRequired ?? mockOnRiskConfirmationRequired
      }
    />,
  );
}

function ackAndType(
  view: ReturnType<typeof render>,
  password: string = VALID_PASSWORD,
): { input: HTMLInputElement; checkbox: HTMLInputElement } {
  const checkbox = view.container.querySelector(
    "[data-vex-polymarket-sudo-ack]",
  ) as HTMLInputElement;
  fireEvent.click(checkbox);
  const input = view.container.querySelector(
    "[data-vex-polymarket-sudo-password]",
  ) as HTMLInputElement;
  fireEvent.input(input, { target: { value: password } });
  return { input, checkbox };
}

function clickSubmit(view: ReturnType<typeof render>): void {
  const submit = view.container.querySelector(
    "[data-vex-polymarket-sudo-submit]",
  ) as HTMLButtonElement;
  fireEvent.click(submit);
}

beforeEach(() => {
  mockAutoSetup.mockReset();
  mockOnClose.mockReset();
  mockOnSuccess.mockReset();
  mockOnRiskConfirmationRequired.mockReset();
  // Default: benign password_invalid so accidental fall-throughs
  // don't generate unhandled rejection noise.
  mockAutoSetup.mockResolvedValue({
    ok: false,
    error: {
      code: "wallet.password_invalid",
      domain: "wallet",
      message: "Master password is incorrect.",
      retryable: true,
      userActionable: true,
      redacted: true,
    },
  });
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: {
      onboarding: {
        polymarketAutoSetup: mockAutoSetup,
      },
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "vex");
});

describe("PolymarketSudoModal", () => {
  it("renders password input, ack checkbox, Cancel + Submit buttons", () => {
    const view = renderModal();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo-password]"),
    ).toBeTruthy();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo-ack]"),
    ).toBeTruthy();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo-cancel]"),
    ).toBeTruthy();
    expect(
      view.container.querySelector("[data-vex-polymarket-sudo-submit]"),
    ).toBeTruthy();
  });

  it("disables Submit until BOTH ack and password length are valid + not pending", () => {
    const view = renderModal();
    const submit = view.container.querySelector(
      "[data-vex-polymarket-sudo-submit]",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const checkbox = view.container.querySelector(
      "[data-vex-polymarket-sudo-ack]",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(submit.disabled).toBe(true);

    const input = view.container.querySelector(
      "[data-vex-polymarket-sudo-password]",
    ) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "abc" } });
    expect(submit.disabled).toBe(true);

    fireEvent.input(input, { target: { value: VALID_PASSWORD } });
    expect(submit.disabled).toBe(false);
  });

  it("calls polymarketAutoSetup with { password, riskAcknowledged: true, overwriteConfirmed }", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: true,
      data: { configured: true, address: EVM_ADDRESS },
    });
    const view = renderModal({ overwriteConfirmed: true });
    ackAndType(view);
    clickSubmit(view);

    await waitFor(() => {
      expect(mockAutoSetup).toHaveBeenCalledWith({
        password: VALID_PASSWORD,
        riskAcknowledged: true,
        overwriteConfirmed: true,
      });
    });
  });

  it("on success: calls onSuccess(result) then onClose", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: true,
      data: { configured: true, address: EVM_ADDRESS },
    });
    const view = renderModal();
    ackAndType(view);
    clickSubmit(view);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledWith({
        configured: true,
        address: EVM_ADDRESS,
      });
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("clears the password input synchronously after submit", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: true,
      data: { configured: true, address: EVM_ADDRESS },
    });
    const view = renderModal();
    const { input } = ackAndType(view);
    clickSubmit(view);
    // Password ref is wiped synchronously before await — by the time
    // the test inspects it the value should already be cleared.
    expect(input.value).toBe("");
    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it("renders password_invalid error message", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: false,
      error: {
        code: "wallet.password_invalid",
        domain: "wallet",
        message: "Wrong password.",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    const view = renderModal();
    ackAndType(view, "incorrect-pw-12");
    clickSubmit(view);

    await waitFor(() => {
      const err = view.container.querySelector(
        "[data-vex-polymarket-sudo-error]",
      );
      if (err === null) throw new Error("error not rendered");
      expect(err.textContent).toMatch(/Master password is incorrect/);
    });
  });

  it("renders keystore_locked error message", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: false,
      error: {
        code: "wallet.keystore_locked",
        domain: "wallet",
        message: "Vault locked.",
        retryable: false,
        userActionable: true,
        redacted: true,
      },
    });
    const view = renderModal();
    ackAndType(view);
    clickSubmit(view);

    await waitFor(() => {
      const err = view.container.querySelector(
        "[data-vex-polymarket-sudo-error]",
      );
      if (err === null) throw new Error("error not rendered");
      expect(err.textContent).toMatch(/Vault session locked/);
    });
  });

  it("renders keystore_missing error message", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: false,
      error: {
        code: "wallet.keystore_missing",
        domain: "wallet",
        message: "No EVM keystore.",
        retryable: false,
        userActionable: true,
        redacted: true,
      },
    });
    const view = renderModal();
    ackAndType(view);
    clickSubmit(view);

    await waitFor(() => {
      const err = view.container.querySelector(
        "[data-vex-polymarket-sudo-error]",
      );
      if (err === null) throw new Error("error not rendered");
      expect(err.textContent).toMatch(/EVM wallet keystore not found/);
    });
  });

  it("on risk_confirmation_required: bubbles up (parent owns phase transition, no onClose race)", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: false,
      error: {
        code: "wallet.risk_confirmation_required",
        domain: "wallet",
        message: "Need confirmation.",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    const view = renderModal({ overwriteConfirmed: false });
    ackAndType(view);
    clickSubmit(view);

    await waitFor(() => {
      expect(mockOnRiskConfirmationRequired).toHaveBeenCalledTimes(1);
    });
    // onClose is NOT called by the modal — the parent's
    // onRiskConfirmationRequired handler transitions phase directly,
    // and calling onClose here would race-overwrite that transition
    // back to idle.
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("renders provider.polymarket_setup_failed error with engine message", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: false,
      error: {
        code: "provider.polymarket_setup_failed",
        domain: "onboarding",
        message: "Polymarket derivation rejected the signature.",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    const view = renderModal();
    ackAndType(view);
    clickSubmit(view);

    await waitFor(() => {
      const err = view.container.querySelector(
        "[data-vex-polymarket-sudo-error]",
      );
      if (err === null) throw new Error("error not rendered");
      expect(err.textContent).toMatch(/Polymarket setup failed/);
      expect(err.textContent).toMatch(/derivation rejected/);
    });
  });

  it("renders provider.unavailable error message", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: false,
      error: {
        code: "provider.unavailable",
        domain: "onboarding",
        message: "Service down.",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    const view = renderModal();
    ackAndType(view);
    clickSubmit(view);

    await waitFor(() => {
      const err = view.container.querySelector(
        "[data-vex-polymarket-sudo-error]",
      );
      if (err === null) throw new Error("error not rendered");
      expect(err.textContent).toMatch(/Polymarket service is unavailable/);
    });
  });

  it("renders onboarding.env_persist_failed error message", async () => {
    mockAutoSetup.mockResolvedValue({
      ok: false,
      error: {
        code: "onboarding.env_persist_failed",
        domain: "onboarding",
        message: "Disk error.",
        retryable: false,
        userActionable: true,
        redacted: true,
      },
    });
    const view = renderModal();
    ackAndType(view);
    clickSubmit(view);

    await waitFor(() => {
      const err = view.container.querySelector(
        "[data-vex-polymarket-sudo-error]",
      );
      if (err === null) throw new Error("error not rendered");
      expect(err.textContent).toMatch(/Failed to save credentials to vault/);
    });
  });

  it("Cancel button calls onClose", () => {
    const view = renderModal();
    const cancel = view.container.querySelector(
      "[data-vex-polymarket-sudo-cancel]",
    ) as HTMLButtonElement;
    fireEvent.click(cancel);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
