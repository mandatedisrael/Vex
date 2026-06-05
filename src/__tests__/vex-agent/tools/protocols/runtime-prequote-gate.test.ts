/**
 * executeProtocolTool — Stage 7 prequote gate wiring (integration).
 *
 * Drives the REAL gate (`evaluateSwapPrequoteGate`) through `executeProtocolTool`
 * by mocking only its leaf dependencies (swap-prequotes repo reads + wallet
 * resolve + jupiter resolver) and the catalog/handler/capture surface the
 * taxonomy test mocks. Pins:
 *   - a gated swap with NO fresh prequote → blocked BEFORE the approval gate
 *     (no pendingApproval, fail-closed message, no handler call).
 *   - a gated swap with a fresh `fail` → blocked (safety_fail message).
 *   - a restricted-mode allowed swap (pass / unknown) → pendingApproval with
 *     the TYPED `prequote.verdict` carried onto the result (R5).
 *   - a non-gated mutating tool is NOT gated (no repo reads).
 *   - dryRun preview is NOT gated.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";
import type { SwapPrequote } from "@vex-agent/db/repos/swap-prequotes.js";

// ── Mock surface ──────────────────────────────────────────────────────

vi.mock("@vex-agent/tools/protocols/capture-validator.js", () => ({
  isPreviewExecution: vi.fn(() => false),
  validateCaptureContract: vi.fn(() => true),
}));

vi.mock("@vex-agent/tools/protocols/catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vex-agent/tools/protocols/catalog.js")>();
  return { ...actual, getProtocolManifest: vi.fn(), getProtocolHandler: vi.fn() };
});

vi.mock("@vex-agent/tools/protocols/lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vex-agent/tools/protocols/lifecycle.js")>();
  return { ...actual, isExecutableNamespace: vi.fn(() => true) };
});

vi.mock("@vex-agent/tools/protocols/capture-pipeline.js", () => ({
  extractExternalRefs: vi.fn(() => ({})),
  populateCaptureItems: vi.fn(),
}));
vi.mock("@vex-agent/db/repos/executions.js", () => ({ recordExecution: vi.fn().mockResolvedValue(0) }));
vi.mock("@vex-agent/db/repos/sync.js", () => ({
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
  enqueueRun: vi.fn(),
}));
vi.mock("@vex-agent/db/params.js", () => ({ sanitizeJsonbValue: (v: unknown) => v }));

// Gate leaf deps.
const mockFindLatest = vi.fn<(s: string, h: string, k: string) => Promise<SwapPrequote | null>>();
const mockExistsFail = vi.fn<(s: string, h: string, k: string) => Promise<boolean>>();
vi.mock("@vex-agent/db/repos/swap-prequotes.js", () => ({
  create: vi.fn(),
  findLatestFreshByMatch: (s: string, h: string, k: string) => mockFindLatest(s, h, k),
  existsFreshFailByMatch: (s: string, h: string, k: string) => mockExistsFail(s, h, k),
}));
vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: vi.fn(() => "0xWALLET"),
}));

// ── Dynamic imports after mocks ───────────────────────────────────────

const { executeProtocolTool } = await import("@vex-agent/tools/protocols/runtime.js");
const catalog = await import("@vex-agent/tools/protocols/catalog.js");
const captureValidator = await import("@vex-agent/tools/protocols/capture-validator.js");

// ── Fixtures ──────────────────────────────────────────────────────────

function swapManifest(): ProtocolToolManifest {
  return {
    toolId: "kyberswap.swap.sell",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "sell",
    mutating: true,
    actionKind: "user_wallet_broadcast",
    params: [
      { key: "chain", type: "string", required: true, description: "" },
      { key: "tokenIn", type: "string", required: true, description: "" },
      { key: "tokenOut", type: "string", required: true, description: "" },
      { key: "amountIn", type: "string", required: true, description: "" },
    ],
    exampleParams: {},
  };
}

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
// Lowercase address legs pass viem strict `isAddress` (the gate validates EVM
// legs the same way the kyber execute handler does — an all-uppercase
// non-checksummed string is NOT a valid address).
const TOKEN_IN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_OUT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const restrictedCtx = {
  sessionPermission: "restricted" as const,
  approved: false,
  sessionId: SESSION_ID,
  walletResolution: { source: "default" as const },
  walletPolicy: { kind: "none" as const },
};

const swapParams = { chain: "base", tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1" };

function prequoteRow(verdict: SwapPrequote["safetyVerdict"]): SwapPrequote {
  return {
    prequoteId: "prequote-1", sessionId: SESSION_ID, matchHash: "h".repeat(64),
    kind: "swap", family: "eip155", provider: "kyberswap", chainId: 8453,
    walletAddress: "0xWALLET", tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amount: "1",
    slippageBps: 50, safetyVerdict: verdict, safetyDetail: {}, routeRef: null,
    createdAt: "2026-06-04T10:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

const handlerSpy = vi.fn(async () => ({ success: true, output: "broadcast" }));

beforeEach(() => {
  vi.mocked(captureValidator.isPreviewExecution).mockReturnValue(false);
  vi.mocked(catalog.getProtocolManifest).mockReset().mockReturnValue(swapManifest());
  vi.mocked(catalog.getProtocolHandler).mockReset().mockReturnValue(handlerSpy);
  handlerSpy.mockClear();
  mockFindLatest.mockReset().mockResolvedValue(null);
  mockExistsFail.mockReset().mockResolvedValue(false);
});

describe("executeProtocolTool — Stage 7 prequote gate", () => {
  it("blocks a gated swap with NO fresh prequote BEFORE the approval gate (no handler, no pendingApproval)", async () => {
    const result = await executeProtocolTool({ toolId: "kyberswap.swap.sell", params: swapParams }, restrictedCtx);
    expect(result.success).toBe(false);
    expect(result.pendingApproval).toBeUndefined();
    expect(result.output).toMatch(/no fresh quote/i);
    expect(result.actionKind).toBe("user_wallet_broadcast");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("blocks a gated swap with a fresh fail (safety_fail message, no handler)", async () => {
    mockExistsFail.mockResolvedValue(true);
    const result = await executeProtocolTool({ toolId: "kyberswap.swap.sell", params: swapParams }, restrictedCtx);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/flagged unsafe|honeypot|scam/i);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("R5: an allowed (pass) swap in restricted mode → pendingApproval carries prequote.verdict='pass'", async () => {
    mockFindLatest.mockResolvedValue(prequoteRow("pass"));
    const result = await executeProtocolTool({ toolId: "kyberswap.swap.sell", params: swapParams }, restrictedCtx);
    expect(result.pendingApproval).toBe(true);
    expect(result.prequote).toEqual({ verdict: "pass" });
    expect(handlerSpy).not.toHaveBeenCalled(); // gate allowed, approval gate paused
  });

  it("R5: an allowed (unknown) swap in restricted mode → pendingApproval carries prequote.verdict='unknown'", async () => {
    mockFindLatest.mockResolvedValue(prequoteRow("unknown"));
    const result = await executeProtocolTool({ toolId: "kyberswap.swap.sell", params: swapParams }, restrictedCtx);
    expect(result.pendingApproval).toBe(true);
    expect(result.prequote).toEqual({ verdict: "unknown" });
  });

  it("full-auto (approved): an allowed swap passes the gate and runs the handler", async () => {
    mockFindLatest.mockResolvedValue(prequoteRow("unknown"));
    const result = await executeProtocolTool(
      { toolId: "kyberswap.swap.sell", params: swapParams },
      { ...restrictedCtx, sessionPermission: "full", approved: true },
    );
    expect(result.success).toBe(true);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT gate a non-EXECUTE_GATE_TOOLS mutating tool (no repo reads)", async () => {
    // A mutating tool that is NOT in EXECUTE_GATE_TOOLS (swap executes + the
    // Khalani bridge are gated; a Polymarket order is not).
    vi.mocked(catalog.getProtocolManifest).mockReturnValue({
      ...swapManifest(),
      toolId: "polymarket.clob.buy",
      namespace: "polymarket",
      params: [],
    });
    const result = await executeProtocolTool({ toolId: "polymarket.clob.buy", params: {} }, restrictedCtx);
    // Reaches the approval gate WITHOUT a prequote binding (not a gated tool).
    expect(result.pendingApproval).toBe(true);
    expect(result.prequote).toBeUndefined();
    expect(mockExistsFail).not.toHaveBeenCalled();
    expect(mockFindLatest).not.toHaveBeenCalled();
  });

  it("does NOT gate a dryRun preview of a gated swap", async () => {
    vi.mocked(captureValidator.isPreviewExecution).mockReturnValue(true);
    const result = await executeProtocolTool(
      { toolId: "kyberswap.swap.sell", params: { ...swapParams, dryRun: true } },
      { ...restrictedCtx, sessionPermission: "full", approved: true },
    );
    expect(result.success).toBe(true);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(mockExistsFail).not.toHaveBeenCalled();
    expect(mockFindLatest).not.toHaveBeenCalled();
  });
});
