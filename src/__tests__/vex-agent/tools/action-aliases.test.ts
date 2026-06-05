/**
 * Action-named READ-ONLY alias handlers (Stage 8a).
 *
 * Asserts each alias resolves the correct TARGET protocol toolId and the
 * EXACT translated params, by mocking `executeProtocolTool` to capture its
 * arguments (the underlying protocol runtime is exercised elsewhere). Covers:
 *
 *   - swap_quote family router: EVM → kyberswap.swap.quote, "solana" →
 *     solana.swap.quote, ambiguous chain → clear failure (no dispatch).
 *   - swap_quote EVM token guard: a bare symbol is rejected (no dispatch) — EVM
 *     tokens must be a contract address or native; symbols resolve via token_find.
 *   - token_check / bridge_quote pass-through translation.
 *   - bridge_status: orders.get with an id, orders.list without.
 *
 * `resolveChainSlug` is NOT mocked — the router's real EVM/Solana decision is
 * under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the (toolId, params) every alias dispatches. The handlers import
// `executeProtocolTool` from "../protocols/runtime.js"; mocking that module
// here intercepts the call and lets us assert the translated request.
// `vi.hoisted` is required because the `vi.mock` factory is hoisted above
// regular top-level declarations.
const { executeProtocolTool } = vi.hoisted(() => ({
  executeProtocolTool: vi.fn(async () => ({ success: true, output: "ok" })),
}));

vi.mock("@vex-agent/tools/protocols/runtime.js", () => ({
  executeProtocolTool,
}));

import {
  handleSwapQuote,
  handleTokenCheck,
  handleBridgeStatus,
  handleBridgeQuote,
} from "@vex-agent/tools/internal/action-aliases.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";

// Minimal context — the aliases only forward the execution-context slice
// `protocolContext()` projects; the rest is never read by these handlers.
const CTX = {
  sessionPermission: "restricted",
  approved: false,
  sessionId: "sess-1",
  walletResolution: { source: "default" },
  walletPolicy: { kind: "none" },
} as unknown as InternalToolContext;

function lastCall(): { toolId: string; params: Record<string, unknown> } {
  const call = executeProtocolTool.mock.calls.at(-1);
  if (!call) throw new Error("executeProtocolTool was not called");
  const request = call[0] as { toolId: string; params: Record<string, unknown> };
  return { toolId: request.toolId, params: request.params };
}

beforeEach(() => {
  executeProtocolTool.mockClear();
});

describe("swap_quote — family router", () => {
  // EVM token addresses (the quote path is now strict: address-or-native only).
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

  it("EVM chain dispatches kyberswap.swap.quote with amount→amountIn (native + address)", async () => {
    const result = await handleSwapQuote(
      { chain: "base", tokenIn: "ETH", tokenOut: USDC, amount: "1.5", slippageBps: 50 },
      CTX,
    );
    expect(result.success).toBe(true);
    const { toolId, params } = lastCall();
    expect(toolId).toBe("kyberswap.swap.quote");
    expect(params).toEqual({
      chain: "base",
      tokenIn: "ETH",
      tokenOut: USDC,
      amountIn: "1.5",
      slippageBps: 50,
    });
  });

  it("EVM alias chain is normalized to the canonical slug (arb → arbitrum)", async () => {
    await handleSwapQuote({ chain: "arb", tokenIn: "ETH", tokenOut: USDC, amount: "1" }, CTX);
    const { toolId, params } = lastCall();
    expect(toolId).toBe("kyberswap.swap.quote");
    expect(params.chain).toBe("arbitrum");
    expect(params.amountIn).toBe("1");
    expect(params).not.toHaveProperty("slippageBps");
  });

  it("rejects a bare EVM symbol — clear fail, no dispatch (symbol must be resolved with token_find)", async () => {
    const result = await handleSwapQuote(
      { chain: "base", tokenIn: "ETH", tokenOut: "USDC", amount: "1" },
      CTX,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("EVM tokens must be a contract address");
    expect(result.output).toContain("token_find");
    expect(executeProtocolTool).not.toHaveBeenCalled();
  });

  it("accepts the native sentinel address and native keyword on the EVM path", async () => {
    const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    await handleSwapQuote({ chain: "base", tokenIn: NATIVE, tokenOut: "native", amount: "1" }, CTX);
    const { toolId, params } = lastCall();
    expect(toolId).toBe("kyberswap.swap.quote");
    expect(params.tokenIn).toBe(NATIVE);
    expect(params.tokenOut).toBe("native");
  });

  it('chain "solana" dispatches solana.swap.quote with tokenIn→inputToken and numeric amount', async () => {
    await handleSwapQuote(
      { chain: "solana", tokenIn: "SOL", tokenOut: "USDC", amount: "2.0", slippageBps: 30 },
      CTX,
    );
    const { toolId, params } = lastCall();
    expect(toolId).toBe("solana.swap.quote");
    expect(params).toEqual({
      inputToken: "SOL",
      outputToken: "USDC",
      amount: 2,
      slippageBps: 30,
    });
    // Solana manifest types amount as number — the alias must coerce.
    expect(typeof params.amount).toBe("number");
  });

  it("ambiguous/unknown chain fails clearly and does NOT dispatch", async () => {
    const result = await handleSwapQuote(
      { chain: "not-a-chain", tokenIn: "A", tokenOut: "B", amount: "1" },
      CTX,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("swap family");
    expect(executeProtocolTool).not.toHaveBeenCalled();
  });

  it("rejects missing required args at the boundary (no dispatch)", async () => {
    const result = await handleSwapQuote({ chain: "base", tokenIn: "ETH" }, CTX);
    expect(result.success).toBe(false);
    expect(executeProtocolTool).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric Solana amount (no dispatch)", async () => {
    const result = await handleSwapQuote(
      { chain: "solana", tokenIn: "SOL", tokenOut: "USDC", amount: "abc" },
      CTX,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("positive number");
    expect(executeProtocolTool).not.toHaveBeenCalled();
  });
});

describe("token_check — pass-through to kyberswap.tokens.check", () => {
  it("forwards chain + address verbatim", async () => {
    await handleTokenCheck({ chain: "ethereum", address: "0xabc" }, CTX);
    const { toolId, params } = lastCall();
    expect(toolId).toBe("kyberswap.tokens.check");
    expect(params).toEqual({ chain: "ethereum", address: "0xabc" });
  });

  it("rejects missing address (no dispatch)", async () => {
    const result = await handleTokenCheck({ chain: "ethereum" }, CTX);
    expect(result.success).toBe(false);
    expect(executeProtocolTool).not.toHaveBeenCalled();
  });
});

describe("bridge_status — orders.get (id) vs orders.list (no id)", () => {
  it("with orderId routes to khalani.orders.get", async () => {
    await handleBridgeStatus({ orderId: "order_abc123" }, CTX);
    const { toolId, params } = lastCall();
    expect(toolId).toBe("khalani.orders.get");
    expect(params).toEqual({ orderId: "order_abc123" });
  });

  it("without orderId routes to khalani.orders.list and forwards provided filters", async () => {
    await handleBridgeStatus({ wallet: "solana", limit: 20 }, CTX);
    const { toolId, params } = lastCall();
    expect(toolId).toBe("khalani.orders.list");
    expect(params).toEqual({ wallet: "solana", limit: 20 });
  });

  it("orderId takes precedence — list filters are ignored when an id is present", async () => {
    await handleBridgeStatus({ orderId: "order_x", wallet: "solana", limit: 5 }, CTX);
    const { toolId, params } = lastCall();
    expect(toolId).toBe("khalani.orders.get");
    expect(params).toEqual({ orderId: "order_x" });
  });
});

describe("bridge_quote — pass-through to khalani.quote.get", () => {
  it("forwards required + provided optional params", async () => {
    await handleBridgeQuote(
      {
        fromChain: "ethereum",
        fromToken: "0xfrom",
        toChain: "solana",
        toToken: "mintTo",
        amount: "1000000",
        tradeType: "EXACT_INPUT",
      },
      CTX,
    );
    const { toolId, params } = lastCall();
    expect(toolId).toBe("khalani.quote.get");
    expect(params).toEqual({
      fromChain: "ethereum",
      fromToken: "0xfrom",
      toChain: "solana",
      toToken: "mintTo",
      amount: "1000000",
      tradeType: "EXACT_INPUT",
    });
  });

  it("omits optional params that were not supplied", async () => {
    await handleBridgeQuote(
      { fromChain: "1", fromToken: "0xa", toChain: "8453", toToken: "0xb", amount: "5" },
      CTX,
    );
    const { params } = lastCall();
    expect(params).toEqual({
      fromChain: "1",
      fromToken: "0xa",
      toChain: "8453",
      toToken: "0xb",
      amount: "5",
    });
    expect(params).not.toHaveProperty("tradeType");
  });

  it("rejects missing required params (no dispatch)", async () => {
    const result = await handleBridgeQuote({ fromChain: "1" }, CTX);
    expect(result.success).toBe(false);
    expect(executeProtocolTool).not.toHaveBeenCalled();
  });
});
