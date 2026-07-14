/**
 * relay.bridge ToolResult honesty on terminal Relay statuses.
 *
 * `executeRelayBridge` polls the Relay intent to a terminal status and RETURNS
 * it as a string — `RELAY_TERMINAL_STATUSES` includes "failure" and "refund",
 * and `pollToTerminal` does not throw on either. The handler previously
 * returned a hardcoded `success: true` (with a literal `success: true` in the
 * output JSON next to `status: "failure"`), so a bridge the Relay API reported
 * as terminally failed or refunded still read as a successful tool call to the
 * agent, and its capture passed the success-gated projection pipeline
 * (runtime/capture.ts populates proj_activity ONLY for successful executions;
 * db/repos/activity.ts documents that a failed action never emits
 * `_tradeCapture`).
 *
 * This suite pins the honest mapping:
 *   - "failure" / "refund"  → success: false, NO `_tradeCapture`, NO auto-pin;
 *     structured status/requestId/txHashes preserved in the output, and a
 *     refund says so (funds returned) so the agent does not invent recovery.
 *   - "success"             → unchanged (success: true, capture "executed", pin).
 *   - "pending" (poll window exhausted; the bridge may still complete)
 *                           → unchanged success/capture/pin semantics, plus an
 *     explicit message so the model does not read "pending" as completion.
 *
 * NOTE: this is the API-status layer, distinct from the per-step on-chain
 * receipt guard (receipt-guard.ts): every step can mine successfully and the
 * Relay intent can still terminate as failure/refund.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";
import type { RelayQuoteResponse } from "@tools/relay/types.js";

const SEL_EVM = "0x1111111111111111111111111111111111111111";

const mockGetQuote = vi.fn();
const mockGetCachedRelayChains = vi.fn();
vi.mock("@tools/relay/client.js", () => ({
  getRelayClient: () => ({ getQuote: (...a: unknown[]) => mockGetQuote(...a) }),
  getCachedRelayChains: (...a: unknown[]) => mockGetCachedRelayChains(...a),
}));

const mockExecuteRelayBridge = vi.fn();
vi.mock("@tools/relay/execute.js", () => ({
  executeRelayBridge: (...a: unknown[]) => mockExecuteRelayBridge(...a),
}));

vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: () => SEL_EVM,
  resolveSigningWallet: () => ({ family: "eip155", address: SEL_EVM, privateKey: ("0x" + "ab".repeat(32)) as `0x${string}` }),
  walletScopeErrorToResult: (err: unknown) => ({ success: false, output: err instanceof Error ? err.message : String(err) }),
}));

const mockPinTrackedToken = vi.fn();
vi.mock("@vex-agent/db/repos/tracked-tokens.js", () => ({
  pinTrackedToken: (...a: unknown[]) => mockPinTrackedToken(...a),
}));

const { RELAY_BRIDGE_HANDLERS } = await import("@vex-agent/tools/protocols/relay/handlers/bridge.js");

const SESSION_CTX: ProtocolExecutionContext = {
  sessionPermission: "full",
  approved: true,
  walletResolution: { source: "session", evm: { id: "w-evm", address: SEL_EVM }, solana: null },
  walletPolicy: { kind: "none" },
};

const CHAINS = [
  { id: 8453, name: "base", currency: { symbol: "ETH", decimals: 18 } },
  { id: 4663, name: "robinhood", currency: { symbol: "ETH", decimals: 18 } },
];

const STEP = {
  id: "deposit",
  kind: "transaction",
  requestId: "0xreq",
  items: [{ status: "incomplete", data: { to: "0x2222222222222222222222222222222222222222", value: "1714000000000000", data: "0x", chainId: 8453 } }],
};

// ERC-20 destination on a LOCAL chain (4663) so the auto-pin path is armed.
const PARAMS = {
  fromChain: "base",
  fromToken: "native",
  toChain: "robinhood",
  toToken: "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31",
  amount: "1714000000000000",
};

function bridgeResult(finalStatus: string, statusObserved = true) {
  // `transactions` (per-hop broadcast records) is required by the success/
  // pending path's `_explorerRefs` mapping (explorer-links feature, landed
  // after this suite's original PR baseline) — the terminal failure/refund
  // path returns before that mapping runs, so it does not need this field,
  // but the mock must supply it for the "success" and "pending" cases.
  // `statusObserved` defaults true: every case below except the explicit
  // "unverifiable" test represents a status that WAS actually observed.
  return { requestId: "0xreq", finalStatus, txHashes: ["0xhash1"], transactions: [{ chainId: 8453, hash: "0xhash1" }], statusObserved };
}

async function runBridge(finalStatus: string, statusObserved = true) {
  mockExecuteRelayBridge.mockResolvedValue(bridgeResult(finalStatus, statusObserved));
  return RELAY_BRIDGE_HANDLERS["relay.bridge"]!(PARAMS, SESSION_CTX);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCachedRelayChains.mockResolvedValue(CHAINS);
  mockGetQuote.mockResolvedValue({ steps: [STEP] } as RelayQuoteResponse);
  mockPinTrackedToken.mockResolvedValue({ inserted: true });
});

describe("relay.bridge — terminal failure/refund must fail the tool result", () => {
  for (const finalStatus of ["failure", "refund"] as const) {
    it(`finalStatus "${finalStatus}" → success: false, status/requestId/txHashes preserved in output`, async () => {
      const result = await runBridge(finalStatus);
      expect(result.success).toBe(false);
      const output = JSON.parse(result.output) as Record<string, unknown>;
      expect(output.success).toBe(false);
      expect(output.status).toBe(finalStatus);
      expect(output.requestId).toBe("0xreq");
      expect(output.txHashes).toEqual(["0xhash1"]);
    });

    it(`finalStatus "${finalStatus}" → NO _tradeCapture (failures never reach proj_activity)`, async () => {
      const result = await runBridge(finalStatus);
      const data = result.data as Record<string, unknown> | undefined;
      expect(data?._tradeCapture).toBeUndefined();
      // Correlation fields survive for diagnostics.
      expect(data?.requestId).toBe("0xreq");
      expect(data?.status).toBe(finalStatus);
    });

    it(`finalStatus "${finalStatus}" → destination token is NOT auto-pinned`, async () => {
      await runBridge(finalStatus);
      expect(mockPinTrackedToken).not.toHaveBeenCalled();
    });
  }

  it('a refund tells the agent funds were returned (no phantom "arrived" balance)', async () => {
    const result = await runBridge("refund");
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(String(output.message)).toMatch(/refund/i);
  });
});

describe("relay.bridge — success path is unchanged (regression)", () => {
  it('finalStatus "success" → success: true, capture "executed", destination pinned', async () => {
    const result = await runBridge("success");
    expect(result.success).toBe(true);
    const capture = (result.data as { _tradeCapture?: Record<string, unknown> })._tradeCapture;
    expect(capture?.status).toBe("executed");
    expect(mockPinTrackedToken).toHaveBeenCalledWith({
      walletAddress: SEL_EVM,
      chainId: 4663,
      tokenAddress: "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31",
      source: "bridge",
    });
  });
});

describe("relay.bridge — pending (poll window exhausted, may still complete)", () => {
  it('finalStatus "pending" → success/capture/pin semantics preserved, explicit message added', async () => {
    const result = await runBridge("pending");
    // Broadcast happened and the bridge may still confirm: keep the tool result
    // successful so the "pending" capture keeps its ledger trace (the projection
    // gate drops captures from failed results).
    expect(result.success).toBe(true);
    const capture = (result.data as { _tradeCapture?: Record<string, unknown> })._tradeCapture;
    expect(capture?.status).toBe("pending");
    expect(mockPinTrackedToken).toHaveBeenCalled();
    // …but the model must not read "pending" as completion.
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(String(output.message)).toMatch(/not.*confirm/i);
  });

  it("surfaces the ACTUAL last-seen non-terminal status in output.status AND the message (not flattened to a generic 'pending')", async () => {
    // "submitted" is a live, non-terminal Relay status distinct from the
    // "pending" default — the capture still records "pending" (non-success), but
    // the raw last-seen value must reach the model verbatim so it can reason
    // about how far the bridge actually got.
    const result = await runBridge("submitted");
    expect(result.success).toBe(true);
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(output.status).toBe("submitted");
    expect(String(output.message)).toContain("submitted");
    const capture = (result.data as { _tradeCapture?: Record<string, unknown> })._tradeCapture;
    expect(capture?.status).toBe("pending");
  });
});

describe("relay.bridge — status unverifiable (every poll threw / no request id)", () => {
  it("statusObserved:false → success:false, NO _tradeCapture, NO pin, correlation ids preserved", async () => {
    // finalStatus is the synthetic "pending" seed, but the status was NEVER
    // observed — the handler must NOT mask that as a benign pending capture.
    const result = await runBridge("pending", false);
    expect(result.success).toBe(false);
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(output.success).toBe(false);
    expect(output.status).toBe("unverified");
    expect(output.requestId).toBe("0xreq");
    expect(output.txHashes).toEqual(["0xhash1"]);
    expect(String(output.message)).toMatch(/could NOT be verified|unreachable/i);
    const data = result.data as Record<string, unknown> | undefined;
    expect(data?._tradeCapture).toBeUndefined();
    expect(mockPinTrackedToken).not.toHaveBeenCalled();
  });
});
