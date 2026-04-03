import { describe, it, expect, vi } from "vitest";

// ── Mocks for zap.in positionKey regression test ──────────────────

vi.mock("@tools/wallet/multi-auth.js", () => ({
  requireEvmWallet: () => ({
    family: "eip155",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    privateKey: "0x" + "ab".repeat(32),
  }),
}));

const mockGetZapInRoute = vi.fn();
const mockBuildZapIn = vi.fn();

vi.mock("@tools/kyberswap/zaas/client.js", () => ({
  getKyberZaasClient: () => ({
    getZapInRoute: (...args: unknown[]) => mockGetZapInRoute(...args),
    buildZapIn: (...args: unknown[]) => mockBuildZapIn(...args),
  }),
}));

const mockExtractMintedNftId = vi.fn();

vi.mock("@tools/kyberswap/evm-utils.js", () => ({
  getKyberEvmClients: () => ({
    publicClient: {},
    walletClient: {},
  }),
  ensureKyberAllowance: vi.fn().mockResolvedValue(undefined),
  sendKyberTransaction: vi.fn().mockResolvedValue("0xmockhash"),
  sendKyberTransactionWithReceipt: vi.fn().mockResolvedValue({
    hash: "0xzaphash",
    receipt: { logs: [{ topics: ["0xddf252ad"], data: "0x" }] },
  }),
  extractMintedNftId: (...args: unknown[]) => mockExtractMintedNftId(...args),
  verifyRouterAddress: vi.fn(),
}));

import { KYBERSWAP_HANDLERS } from "../../../echo-agent/tools/protocols/kyberswap/handlers.js";
import { KYBERSWAP_TOOLS } from "../../../echo-agent/tools/protocols/kyberswap/manifest.js";

describe("kyberswap handlers", () => {
  // ── Handler coverage ─────────────────────────────────────────────

  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(KYBERSWAP_HANDLERS));
    const manifestIds = KYBERSWAP_TOOLS.map(t => t.toolId);
    const missing = manifestIds.filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(KYBERSWAP_TOOLS.map(t => t.toolId));
    const handlerKeys = Object.keys(KYBERSWAP_HANDLERS);
    const extra = handlerKeys.filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count (21)", () => {
    expect(Object.keys(KYBERSWAP_HANDLERS)).toHaveLength(21);
  });

  it("every handler is a function", () => {
    for (const [, handler] of Object.entries(KYBERSWAP_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // ── Required param validation ────────────────────────────────────

  it("kyberswap.tokens.search fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.tokens.search"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.tokens.check fails without chain and address", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.tokens.check"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.swap.quote fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.swap.sell fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.sell"]!(
      { chain: "ethereum", tokenIn: "ETH" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.swap.buy fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.buy"]!(
      { chain: "ethereum", tokenIn: "USDC" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.list fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.list"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.limitOrder.activeMakingAmount fails without chain and makerAsset", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.activeMakingAmount"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("makerAsset");
  });

  it("kyberswap.limitOrder.create fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.create"]!(
      { chain: "ethereum", makerAsset: "USDC" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.cancel fails without chain and orderId", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.cancel"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("orderId");
  });

  it("kyberswap.limitOrder.hardCancel fails without chain and orderId", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.hardCancel"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.limitOrder.pairs fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.pairs"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.limitOrder.fill fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.fill"]!(
      { chain: "ethereum", orderId: 123 },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.batchFill fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.batchFill"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.cancelAll fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.cancelAll"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.zap.in fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.in"]!(
      { chain: "ethereum", dex: "uniswapv3" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.zap.out fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.out"]!(
      { chain: "ethereum" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.zap.migrate fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.migrate"]!(
      { chain: "ethereum", dexFrom: "uniswapv3" },
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  // ── Read-only handlers return data (no wallet needed) ────────────

  it("kyberswap.chains returns chain list", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.chains"]!(
      {},
      { loopMode: "off", approved: false },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(20);
    expect(data[0].slug).toBeDefined();
    expect(data[0].chainId).toBeDefined();
    expect(data[0].aggregator).toBeDefined();
  });

  // ── zap.in positionKey regression ───────────────────────────────

  it("kyberswap.zap.in captures positionKey from receipt NFT mint", async () => {
    mockGetZapInRoute.mockResolvedValueOnce({
      data: {
        route: { some: "route" },
        routerAddress: "0x2f1E23e0A5A56e7746E1Ae42d5c3112B2d0cf09B",
        zapDetails: { initialAmountUsd: "50.00", actions: [] },
      },
    });
    mockBuildZapIn.mockResolvedValueOnce({
      data: {
        routerAddress: "0x2f1E23e0A5A56e7746E1Ae42d5c3112B2d0cf09B",
        callData: "0xdeadbeef",
        value: "0",
      },
    });
    mockExtractMintedNftId.mockReturnValueOnce("12345");

    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.in"]!(
      {
        chain: "polygon", dex: "DEX_UNISWAPV3", pool: "0xPoolAddress",
        tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        amountIn: "1000000000000000000",
      },
      { loopMode: "full", approved: true },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const capture = result.data!._tradeCapture as Record<string, unknown>;
    expect(capture.type).toBe("lp");
    expect(capture.positionKey).toBe("12345");
    expect(capture.instrumentKey).toBe("polygon:lp:0xPoolAddress");
    expect(capture.valuationSource).toBe("zaas_estimate");
    expect(mockExtractMintedNftId).toHaveBeenCalledTimes(1);
  });
});
