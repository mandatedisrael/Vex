/**
 * khalani.bridge ToolResult honesty on terminal order status.
 *
 * Khalani's Integration Guide requires tracking a submitted order to a TERMINAL
 * state (filled | refunded | failed). The deposit tx mining does NOT mean the
 * destination leg filled — the handler previously hardcoded capture status
 * "pending" and `success: true` regardless of the eventual order outcome, so a
 * failed/refunded bridge still read as a successful tool call and rode a phantom
 * "pending" capture into the projection pipeline.
 *
 * This suite pins the honest mapping (poll result is stubbed — the poll LOOP
 * itself, incl. the 5s×24 budget, is covered in tools/khalani/order-status.test):
 *   - filled                 → success:true, capture "executed", no warning msg;
 *   - failed / refunded       → success:false, NO _tradeCapture, explicit
 *     funds-returned/failed message; last-seen status stays readable;
 *   - created/deposited/published (window close) → success:true, capture
 *     "pending", explicit "NOT confirmed" message + actual last-seen status;
 *   - refund_pending (window close) → success:true, capture "pending", explicit
 *     "refund in flight, not yet delivered" message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

const SEL_EVM = "0x1111111111111111111111111111111111111111";

vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: () => SEL_EVM,
  resolveSigningWallet: () => ({ family: "eip155", address: SEL_EVM, privateKey: ("0x" + "ab".repeat(32)) as `0x${string}` }),
  walletScopeErrorToResult: (err: unknown) => ({ success: false, output: err instanceof Error ? err.message : String(err) }),
}));

vi.mock("@tools/khalani/chains.js", () => ({
  getCachedKhalaniChains: vi.fn().mockResolvedValue([]),
  getChain: vi.fn(() => ({ id: 1, type: "eip155" })),
  getChainFamily: vi.fn(() => "eip155"),
  resolveChainId: vi.fn(() => 1),
}));

vi.mock("@tools/wallet/inventory.js", () => ({
  walletAddressesEqual: (_fam: string, a: string, b: string) => a === b,
  familyToInventory: (f: string) => (f === "solana" ? "solana" : "evm"),
}));

vi.mock("@tools/khalani/request.js", () => ({
  prepareQuoteRequest: vi.fn(async (input: { fromAddress: string; recipient: string }) => ({
    chains: [],
    fromChainId: 1,
    toChainId: 42,
    fromFamily: "eip155",
    toFamily: "eip155",
    request: { fromAddress: input.fromAddress, recipient: input.recipient },
  })),
}));

vi.mock("@tools/khalani/client.js", () => ({
  getKhalaniClient: () => ({
    getQuotes: vi.fn(async () => ({
      quoteId: "q1",
      routes: [{ routeId: "r1", type: "fast", quote: { amountIn: "1", amountOut: "5", expectedDurationSeconds: 10, quoteExpiresAt: 0, validBefore: 0 } }],
    })),
    buildDeposit: vi.fn(async () => ({ kind: "CONTRACT_CALL", approvals: [] })),
  }),
}));

vi.mock("@tools/khalani/helpers.js", () => ({ resolveRouteBestIndex: () => 0 }));

vi.mock("@tools/khalani/bridge-executor.js", () => ({
  executeDepositPlan: vi.fn(async () => ({ orderId: "o1", txHash: "0xhash" })),
}));

const mockPollOrderToTerminal = vi.fn();
vi.mock("@tools/khalani/order-status.js", () => ({
  pollKhalaniOrderToTerminal: (...a: unknown[]) => mockPollOrderToTerminal(...a),
}));

const { BRIDGE_HANDLERS } = await import("@vex-agent/tools/protocols/khalani/handlers/bridge.js");

const SESSION_CTX: ProtocolExecutionContext = {
  sessionPermission: "full",
  approved: true,
  walletResolution: { source: "session", evm: { id: "w-evm", address: SEL_EVM }, solana: null },
  walletPolicy: { kind: "none" },
};

const PARAMS = { fromChain: "ethereum", toChain: "robinhood", fromToken: "USDC", toToken: "USDC", amount: "1000000" };

const TERMINAL = new Set(["filled", "refunded", "failed"]);

/** Map a status string to the poll module's discriminated result for the handler. */
async function runBridge(finalStatus: string) {
  const poll = TERMINAL.has(finalStatus)
    ? { kind: "terminal", status: finalStatus }
    : { kind: "pending", status: finalStatus };
  mockPollOrderToTerminal.mockResolvedValue(poll);
  return BRIDGE_HANDLERS["khalani.bridge"]!(PARAMS, SESSION_CTX);
}

/** The status-unavailable outcome (every poll threw). */
async function runBridgeUnavailable() {
  mockPollOrderToTerminal.mockResolvedValue({ kind: "unavailable" });
  return BRIDGE_HANDLERS["khalani.bridge"]!(PARAMS, SESSION_CTX);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("khalani.bridge — terminal failure/refund must fail the tool result", () => {
  for (const finalStatus of ["failed", "refunded"] as const) {
    it(`finalStatus "${finalStatus}" → success:false, last-seen status preserved in output`, async () => {
      const result = await runBridge(finalStatus);
      expect(result.success).toBe(false);
      const output = JSON.parse(result.output) as Record<string, unknown>;
      expect(output.success).toBe(false);
      expect(output.status).toBe(finalStatus);
      expect(output.orderId).toBe("o1");
    });

    it(`finalStatus "${finalStatus}" → NO _tradeCapture (failures never reach proj_activity)`, async () => {
      const result = await runBridge(finalStatus);
      expect(result.data?._tradeCapture).toBeUndefined();
      expect(result.data?.orderId).toBe("o1");
      expect(result.data?.status).toBe(finalStatus);
    });
  }

  it('a refund tells the agent funds were returned (no phantom "arrived" balance)', async () => {
    const result = await runBridge("refunded");
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(String(output.message)).toMatch(/refund/i);
    expect(String(output.message)).toMatch(/did NOT arrive/i);
  });

  it("a failure tells the agent nothing arrived", async () => {
    const result = await runBridge("failed");
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(String(output.message)).toMatch(/failed/i);
    expect(String(output.message)).toMatch(/did NOT arrive/i);
  });
});

describe("khalani.bridge — filled is a confirmed delivery (success path)", () => {
  it('finalStatus "filled" → success:true, capture "executed", no warning message', async () => {
    const result = await runBridge("filled");
    expect(result.success).toBe(true);
    const capture = (result.data as { _tradeCapture?: Record<string, unknown> })._tradeCapture;
    expect(capture?.status).toBe("executed");
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(output.status).toBe("filled");
    expect("message" in output).toBe(false);
  });
});

describe("khalani.bridge — non-terminal window close must NOT read as delivery", () => {
  for (const finalStatus of ["created", "deposited", "published"] as const) {
    it(`finalStatus "${finalStatus}" → success:true, capture "pending", explicit not-confirmed message + last-seen status`, async () => {
      const result = await runBridge(finalStatus);
      expect(result.success).toBe(true);
      const capture = (result.data as { _tradeCapture?: Record<string, unknown> })._tradeCapture;
      expect(capture?.status).toBe("pending");
      const output = JSON.parse(result.output) as Record<string, unknown>;
      expect(output.status).toBe(finalStatus);
      expect(String(output.message)).toMatch(/not.*confirm/i);
      expect(String(output.message)).toContain(finalStatus);
    });
  }

  it('finalStatus "refund_pending" → success:true, capture "pending", refund-in-flight-not-delivered message', async () => {
    const result = await runBridge("refund_pending");
    expect(result.success).toBe(true);
    const capture = (result.data as { _tradeCapture?: Record<string, unknown> })._tradeCapture;
    expect(capture?.status).toBe("pending");
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(output.status).toBe("refund_pending");
    expect(String(output.message)).toMatch(/refund/i);
    expect(String(output.message)).toMatch(/in flight|not yet delivered|did NOT arrive/i);
  });
});

describe("khalani.bridge — status unavailable (every poll threw) must NOT read as pending", () => {
  it("unavailable → success:false, NO _tradeCapture, correlation ids (orderId + deposit txHash) preserved", async () => {
    const result = await runBridgeUnavailable();
    expect(result.success).toBe(false);
    // A total status outage must not enqueue a projection for an unobserved order.
    expect(result.data?._tradeCapture).toBeUndefined();
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(output.success).toBe(false);
    expect(output.status).toBe("unverified");
    expect(output.orderId).toBe("o1");
    expect(output.txHash).toBe("0xhash");
    expect(String(output.message)).toMatch(/could NOT be verified|unreachable|UNCONFIRMED/i);
    // Correlation ids also on data for the audit log.
    expect(result.data?.orderId).toBe("o1");
    expect(result.data?.txHash).toBe("0xhash");
  });
});
