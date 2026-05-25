/**
 * polymarket_setup handler — per-wallet, session-scoped derive (puzzle 5 B-core-2).
 *
 * Tests the handler directly (approval is enforced upstream by the dispatcher —
 * see dispatcher-misc.test.ts). Mocks the wallet resolver, the creds probe, and
 * the derive primitive so we assert the decision tree without touching keystore,
 * vault, or network.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeTestContext } from "../_test-context.js";

const mocks = vi.hoisted(() => ({
  resolveSelectedAddress: vi.fn(),
  hasCreds: vi.fn(),
  deriveAndSave: vi.fn(),
}));

vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: mocks.resolveSelectedAddress,
  walletScopeErrorToResult: (err: unknown) => ({
    success: false,
    output: err instanceof Error ? err.message : String(err),
  }),
}));
vi.mock("@tools/polymarket/auth.js", () => ({ hasPolyClobCredentials: mocks.hasCreds }));
vi.mock("@tools/wallet/polymarket-credentials.js", () => ({
  deriveAndSavePolymarketCredentials: mocks.deriveAndSave,
}));

const { handlePolymarketSetup } = await import("@vex-agent/tools/internal/polymarket-setup.js");

const SESSION_EVM = `0x${"22".repeat(20)}`;
const PRIMARY_EVM = `0x${"11".repeat(20)}`;

function sessionCtx(evm: { id: string; address: string } | null = { id: "evm_s", address: SESSION_EVM }) {
  return makeTestContext({ walletResolution: { source: "session", evm, solana: null } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handlePolymarketSetup", () => {
  it("returns configured WITHOUT deriving when the selected wallet already has creds", async () => {
    mocks.resolveSelectedAddress.mockReturnValue(SESSION_EVM);
    mocks.hasCreds.mockReturnValue(true);

    const r = await handlePolymarketSetup({}, sessionCtx());

    expect(r.success).toBe(true);
    expect(r.data?.configured).toBe(true);
    expect(mocks.hasCreds).toHaveBeenCalledWith(SESSION_EVM);
    expect(mocks.deriveAndSave).not.toHaveBeenCalled();
  });

  it("derives for the SELECTED wallet id when the session wallet has no creds", async () => {
    mocks.resolveSelectedAddress.mockReturnValue(SESSION_EVM);
    mocks.hasCreds.mockReturnValue(false);
    mocks.deriveAndSave.mockResolvedValue({ apiKeyPrefix: "abcd1234…", storage: "secret-vault", address: SESSION_EVM });

    const r = await handlePolymarketSetup({}, sessionCtx({ id: "evm_s", address: SESSION_EVM }));

    expect(r.success).toBe(true);
    expect(mocks.deriveAndSave).toHaveBeenCalledWith({ walletId: "evm_s" });
  });

  it("fails closed (no derive) when no EVM wallet is selected / scope drift", async () => {
    mocks.resolveSelectedAddress.mockImplementation(() => {
      throw new Error("No eip155 wallet is selected for this session.");
    });

    const r = await handlePolymarketSetup({}, sessionCtx(null));

    expect(r.success).toBe(false);
    expect(mocks.hasCreds).not.toHaveBeenCalled();
    expect(mocks.deriveAndSave).not.toHaveBeenCalled();
  });

  it("derives the PRIMARY (no walletId) on the default (CLI/MCP) path", async () => {
    mocks.resolveSelectedAddress.mockReturnValue(PRIMARY_EVM);
    mocks.hasCreds.mockReturnValue(false);
    mocks.deriveAndSave.mockResolvedValue({ apiKeyPrefix: "p…", storage: "secret-vault", address: PRIMARY_EVM });

    const r = await handlePolymarketSetup({}, makeTestContext({ walletResolution: { source: "default" } }));

    expect(r.success).toBe(true);
    expect(mocks.deriveAndSave).toHaveBeenCalledWith({});
  });

  it("surfaces a derive failure as a tool failure (no throw)", async () => {
    mocks.resolveSelectedAddress.mockReturnValue(SESSION_EVM);
    mocks.hasCreds.mockReturnValue(false);
    mocks.deriveAndSave.mockRejectedValue(new Error("Polymarket API unavailable"));

    const r = await handlePolymarketSetup({}, sessionCtx());

    expect(r.success).toBe(false);
    expect(r.output).toContain("Polymarket setup failed");
  });
});

describe("polymarket_setup visibility (B-core-2 Option A)", () => {
  it("is visible even when POLYMARKET_API_KEY is set (env gate removed)", async () => {
    const prev = process.env.POLYMARKET_API_KEY;
    process.env.POLYMARKET_API_KEY = "primary-configured";
    try {
      const { getVisibleToolDefs, defaultVisibilityContext } = await import("@vex-agent/tools/registry.js");
      const names = getVisibleToolDefs(defaultVisibilityContext()).map((t) => t.name);
      expect(names).toContain("polymarket_setup");
    } finally {
      if (prev === undefined) delete process.env.POLYMARKET_API_KEY;
      else process.env.POLYMARKET_API_KEY = prev;
    }
  });
});
