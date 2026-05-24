/**
 * Server-side wallet-ref resolution (puzzle 5 phase 5C). The renderer sends
 * only IDs; main resolves id → address from the inventory. A renderer-supplied
 * address is never trusted; an unknown id fails closed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetWalletById = vi.fn();
vi.mock("@vex-lib/wallet.js", () => ({
  getWalletById: (...a: unknown[]) => mockGetWalletById(...a),
}));

const { resolveWalletRef, invalidWalletSelectionError } = await import("../_wallet-refs.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveWalletRef", () => {
  it("null / empty id → null (unselected)", () => {
    expect(resolveWalletRef("evm", null)).toBeNull();
    expect(resolveWalletRef("evm", undefined)).toBeNull();
    expect(resolveWalletRef("evm", "")).toBeNull();
    expect(mockGetWalletById).not.toHaveBeenCalled();
  });

  it("known id → {id,address} resolved server-side from inventory", () => {
    mockGetWalletById.mockReturnValue({ id: "evm_1", address: "0xAbc", label: "Main", createdAt: "" });
    expect(resolveWalletRef("evm", "evm_1")).toEqual({ id: "evm_1", address: "0xAbc" });
    expect(mockGetWalletById).toHaveBeenCalledWith("evm", "evm_1");
  });

  it("unknown id → 'invalid' (caller fails closed)", () => {
    mockGetWalletById.mockReturnValue(null);
    expect(resolveWalletRef("solana", "sol_x")).toBe("invalid");
  });
});

describe("invalidWalletSelectionError", () => {
  it("builds a redacted wallets.invalid_selection VexError with the correlation id", () => {
    const e = invalidWalletSelectionError("corr-1");
    expect(e.code).toBe("wallets.invalid_selection");
    expect(e.domain).toBe("wallets");
    expect(e.correlationId).toBe("corr-1");
    expect(e.redacted).toBe(true);
    expect(e.retryable).toBe(false);
  });
});
