/**
 * Khalani bridge per-session wallet scope (puzzle 5 phase 5D-protocols p4).
 *
 * The bridge is cross-chain: the deposit signs with the SOURCE-family wallet and
 * funds land at the dest-family recipient. Proves the handler:
 *   - resolves the session source signer only AFTER the dryRun gate;
 *   - fails closed on an explicit fromAddress mismatch BEFORE quote + executor;
 *   - passes a source-family signer to executeDepositPlan (EVM vs Solana);
 *   - defaults the recipient to the session's dest-family wallet, fail-closed
 *     when neither an explicit recipient nor a selected dest wallet exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

const SEL_EVM = "0x1111111111111111111111111111111111111111";
const SEL_SOL = "So1anaSe1ectedAddr1111111111111111111111111";

const mockResolveSelectedAddress = vi.fn((_r: unknown, _p: unknown, family: string) => (family === "solana" ? SEL_SOL : SEL_EVM));
const mockResolveSigningWallet = vi.fn((_r: unknown, _p: unknown, family: string) =>
  family === "solana"
    ? { family: "solana", address: SEL_SOL, secretKey: new Uint8Array(64) }
    : { family: "eip155", address: SEL_EVM, privateKey: ("0x" + "ab".repeat(32)) as `0x${string}` });
vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: (...a: unknown[]) => mockResolveSelectedAddress(...(a as [unknown, unknown, string])),
  resolveSigningWallet: (...a: unknown[]) => mockResolveSigningWallet(...(a as [unknown, unknown, string])),
  walletScopeErrorToResult: (err: unknown) => ({ success: false, output: err instanceof Error ? err.message : String(err) }),
}));

const mockGetChainFamily = vi.fn(() => "eip155");
vi.mock("@tools/khalani/chains.js", () => ({
  getCachedKhalaniChains: vi.fn().mockResolvedValue([]),
  getChain: vi.fn(() => ({ id: 1, type: "eip155" })),
  getChainFamily: (...a: unknown[]) => mockGetChainFamily(...(a as [])),
  resolveChainId: vi.fn(() => 1),
}));

vi.mock("@tools/wallet/inventory.js", () => ({
  walletAddressesEqual: (_fam: string, a: string, b: string) => a === b,
  familyToInventory: (f: string) => (f === "solana" ? "solana" : "evm"),
}));

const mockPrepareQuoteRequest = vi.fn(async (input: { fromAddress: string; recipient: string }) => ({
  chains: [],
  fromChainId: 1,
  toChainId: 1,
  fromFamily: "eip155",
  toFamily: "eip155",
  request: { fromAddress: input.fromAddress, recipient: input.recipient },
}));
vi.mock("@tools/khalani/request.js", () => ({ prepareQuoteRequest: (...a: unknown[]) => mockPrepareQuoteRequest(...(a as [{ fromAddress: string; recipient: string }])) }));

const mockGetQuotes = vi.fn(async () => ({
  quoteId: "q1",
  routes: [{ routeId: "r1", type: "fast", quote: { amountIn: "1", amountOut: "1", expectedDurationSeconds: 10, quoteExpiresAt: 0, validBefore: 0 } }],
}));
const mockBuildDeposit = vi.fn(async () => ({ kind: "CONTRACT_CALL", approvals: [] }));
vi.mock("@tools/khalani/client.js", () => ({
  getKhalaniClient: () => ({ getQuotes: (...a: unknown[]) => mockGetQuotes(...a), buildDeposit: (...a: unknown[]) => mockBuildDeposit(...a) }),
}));

vi.mock("@tools/khalani/helpers.js", () => ({ resolveRouteBestIndex: () => 0 }));

const mockExecuteDepositPlan = vi.fn(async () => ({ orderId: "o1", txHash: "0xhash" }));
vi.mock("@tools/khalani/bridge-executor.js", () => ({ executeDepositPlan: (...a: unknown[]) => mockExecuteDepositPlan(...a) }));

const { BRIDGE_HANDLERS } = await import("@vex-agent/tools/protocols/khalani/handlers/bridge.js");

const SESSION_CTX: ProtocolExecutionContext = {
  sessionPermission: "full",
  approved: true,
  walletResolution: { source: "session", evm: { id: "w-evm", address: SEL_EVM }, solana: { id: "w-sol", address: SEL_SOL } },
  walletPolicy: { kind: "none" },
};

const baseParams = { fromChain: "ethereum", toChain: "ethereum", fromToken: "USDC", toToken: "USDC", amount: "1000000" };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSelectedAddress.mockImplementation((_r, _p, family) => (family === "solana" ? SEL_SOL : SEL_EVM));
  mockResolveSigningWallet.mockImplementation((_r, _p, family) =>
    family === "solana"
      ? { family: "solana", address: SEL_SOL, secretKey: new Uint8Array(64) }
      : { family: "eip155", address: SEL_EVM, privateKey: ("0x" + "ab".repeat(32)) as `0x${string}` });
  mockGetChainFamily.mockReturnValue("eip155");
  mockGetQuotes.mockResolvedValue({
    quoteId: "q1",
    routes: [{ routeId: "r1", type: "fast", quote: { amountIn: "1", amountOut: "1", expectedDurationSeconds: 10, quoteExpiresAt: 0, validBefore: 0 } }],
  });
  mockBuildDeposit.mockResolvedValue({ kind: "CONTRACT_CALL", approvals: [] });
  mockExecuteDepositPlan.mockResolvedValue({ orderId: "o1", txHash: "0xhash" });
});

describe("khalani.bridge session wallet scope", () => {
  it("dryRun does NOT resolve a signer or call the executor", async () => {
    const r = await BRIDGE_HANDLERS["khalani.bridge"]!({ ...baseParams, dryRun: true }, SESSION_CTX);
    expect(r.success).toBe(true);
    expect(mockResolveSigningWallet).not.toHaveBeenCalled();
    expect(mockExecuteDepositPlan).not.toHaveBeenCalled();
  });

  it("explicit fromAddress mismatch under session fails closed BEFORE quote + executor", async () => {
    const r = await BRIDGE_HANDLERS["khalani.bridge"]!({ ...baseParams, fromAddress: "0x9999999999999999999999999999999999999999" }, SESSION_CTX);
    expect(r.success).toBe(false);
    expect(mockPrepareQuoteRequest).not.toHaveBeenCalled();
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(mockExecuteDepositPlan).not.toHaveBeenCalled();
  });

  it("EVM source passes an EVM signer to the executor", async () => {
    const r = await BRIDGE_HANDLERS["khalani.bridge"]!(baseParams, SESSION_CTX);
    expect(r.success).toBe(true);
    expect(mockExecuteDepositPlan.mock.calls[0][0]).toMatchObject({ signer: { family: "eip155", address: SEL_EVM } });
  });

  it("Solana source passes a Solana signer to the executor", async () => {
    mockGetChainFamily.mockReturnValue("solana"); // both from/to resolve solana for this test
    const r = await BRIDGE_HANDLERS["khalani.bridge"]!(baseParams, SESSION_CTX);
    expect(r.success).toBe(true);
    expect(mockExecuteDepositPlan.mock.calls[0][0]).toMatchObject({ signer: { family: "solana", address: SEL_SOL } });
  });

  it("recipient defaults to the session's dest-family wallet", async () => {
    await BRIDGE_HANDLERS["khalani.bridge"]!(baseParams, SESSION_CTX);
    expect(mockPrepareQuoteRequest.mock.calls[0][0]).toMatchObject({ fromAddress: SEL_EVM, recipient: SEL_EVM });
  });

  it("no explicit recipient + unselected dest family fails closed", async () => {
    // Source eip155 resolves; dest solana has no selected wallet → throws.
    mockGetChainFamily.mockReturnValueOnce("eip155").mockReturnValueOnce("solana");
    mockResolveSelectedAddress.mockImplementation((_r, _p, family) => {
      if (family === "solana") throw new Error("WALLET_NOT_SELECTED");
      return SEL_EVM;
    });
    const r = await BRIDGE_HANDLERS["khalani.bridge"]!(baseParams, SESSION_CTX);
    expect(r.success).toBe(false);
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(mockExecuteDepositPlan).not.toHaveBeenCalled();
  });
});
