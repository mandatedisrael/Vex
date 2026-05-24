/**
 * Engine wallet resolver (resolve.ts) — puzzle 5 phase 5B.
 *
 * Pins the address-only vs signing split + mission-policy enforcement.
 * `resolveSelectedEntry` / `loadWalletFromEntry` are mocked so these tests
 * isolate resolve.ts's POLICY logic (no config/keystore). `walletAddressesEqual`
 * is the real implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrorCodes } from "../../../../../errors.js";
import type { WalletPolicy } from "../../../../../vex-agent/engine/types.js";

const mockResolveSelectedEntry = vi.fn();
const mockLoadWalletFromEntry = vi.fn();

vi.mock("@tools/wallet/multi-auth.js", () => ({
  resolveSelectedEntry: (...a: unknown[]) => mockResolveSelectedEntry(...a),
  loadWalletFromEntry: (...a: unknown[]) => mockLoadWalletFromEntry(...a),
}));

const { resolveSelectedAddress, resolveSigningWallet } = await import(
  "../../../../../vex-agent/tools/internal/wallet/resolve.js"
);

const EVM = "0xabcdef1234567890abcdef1234567890abcdef12";
const SESSION = { source: "session" as const, evm: { id: "evm_x", address: EVM }, solana: null };
const NONE: WalletPolicy = { kind: "none" };

function selectedIs(address = EVM): void {
  mockResolveSelectedEntry.mockReturnValue({
    family: "evm",
    entry: { id: "evm_x", address, label: "x", createdAt: "" },
  });
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e: unknown) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSelectedAddress — address only, never decrypts", () => {
  it("returns the selected entry address without loading the key", () => {
    selectedIs();
    expect(resolveSelectedAddress(SESSION, NONE, "eip155")).toBe(EVM);
    expect(mockLoadWalletFromEntry).not.toHaveBeenCalled();
  });

  it("mission_allowed + address in the allowed set → ok", () => {
    selectedIs();
    const policy: WalletPolicy = { kind: "mission_allowed", allowedWallets: [EVM] };
    expect(resolveSelectedAddress(SESSION, policy, "eip155")).toBe(EVM);
  });

  it("mission_allowed + address NOT in set → SCOPE_MISMATCH", () => {
    selectedIs();
    const policy: WalletPolicy = {
      kind: "mission_allowed",
      allowedWallets: ["0x0000000000000000000000000000000000000000"],
    };
    expect(codeOf(() => resolveSelectedAddress(SESSION, policy, "eip155"))).toBe(
      ErrorCodes.WALLET_SCOPE_MISMATCH,
    );
  });

  it("invalid policy → SCOPE_MISMATCH (mission drift). Enforced from the policy, NOT sessionKind — so a subagent with sessionKind 'agent' that inherited an invalid mission policy also fails closed.", () => {
    selectedIs();
    const policy: WalletPolicy = { kind: "invalid", reason: "empty_allowed_wallets" };
    expect(codeOf(() => resolveSelectedAddress(SESSION, policy, "eip155"))).toBe(
      ErrorCodes.WALLET_SCOPE_MISMATCH,
    );
  });
});

describe("resolveSigningWallet — decrypts only after policy passes", () => {
  it("loads the wallet via loadWalletFromEntry when policy allows", () => {
    selectedIs();
    mockLoadWalletFromEntry.mockReturnValue({ family: "eip155", address: EVM, privateKey: "0x" });
    expect(resolveSigningWallet(SESSION, NONE, "eip155").address).toBe(EVM);
    expect(mockLoadWalletFromEntry).toHaveBeenCalledTimes(1);
  });

  it("policy violation throws BEFORE the key is decrypted", () => {
    selectedIs();
    const policy: WalletPolicy = {
      kind: "mission_allowed",
      allowedWallets: ["0x0000000000000000000000000000000000000000"],
    };
    expect(codeOf(() => resolveSigningWallet(SESSION, policy, "eip155"))).toBe(
      ErrorCodes.WALLET_SCOPE_MISMATCH,
    );
    expect(mockLoadWalletFromEntry).not.toHaveBeenCalled();
  });
});
