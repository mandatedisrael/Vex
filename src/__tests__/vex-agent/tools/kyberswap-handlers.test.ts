import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

// ── Per-session wallet resolution mock (5D-protocols p1) ──────────
// Handlers now resolve the session wallet via resolve.js (NOT the zero-arg
// requireEvmWallet primary). Spy on the resolvers to assert the session wallet
// is used and that preview/dryRun never decrypts a signing key.

const SESSION_EVM = {
  family: "eip155" as const,
  address: "0x1234567890abcdef1234567890abcdef12345678",
  privateKey: ("0x" + "ab".repeat(32)) as `0x${string}`,
};
const mockResolveSigningWallet = vi.fn(() => SESSION_EVM);
const mockResolveSelectedAddress = vi.fn(() => SESSION_EVM.address);

vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSigningWallet: (...args: unknown[]) => mockResolveSigningWallet(...args),
  resolveSelectedAddress: (...args: unknown[]) => mockResolveSelectedAddress(...args),
  walletScopeErrorToResult: (err: unknown) => ({
    success: false,
    output: err instanceof Error ? err.message : String(err),
  }),
}));

/** Type-complete ProtocolExecutionContext for handler tests. */
function ctx(over: Partial<ProtocolExecutionContext> = {}): ProtocolExecutionContext {
  return {
    sessionPermission: "full",
    approved: true,
    walletResolution: { source: "default" },
    walletPolicy: { kind: "none" },
    ...over,
  };
}

const mockGetZapInRoute = vi.fn();
const mockBuildZapIn = vi.fn();
const mockGetZapOutRoute = vi.fn();
const mockBuildZapOut = vi.fn();
const mockGetZapMigrateRoute = vi.fn();
const mockBuildZapMigrate = vi.fn();

vi.mock("@tools/kyberswap/zaas/client.js", () => ({
  getKyberZaasClient: () => ({
    getZapInRoute: (...args: unknown[]) => mockGetZapInRoute(...args),
    buildZapIn: (...args: unknown[]) => mockBuildZapIn(...args),
    getZapOutRoute: (...args: unknown[]) => mockGetZapOutRoute(...args),
    buildZapOut: (...args: unknown[]) => mockBuildZapOut(...args),
    getZapMigrateRoute: (...args: unknown[]) => mockGetZapMigrateRoute(...args),
    buildZapMigrate: (...args: unknown[]) => mockBuildZapMigrate(...args),
  }),
}));

const mockExtractMintedNftId = vi.fn();
const mockExtractErc1155Position = vi.fn();

// readErc20Metadata is used by resolveTokenMetadataStrict for address inputs
// (the quote path is now strict/address-only, matching execute).
// Default: return plain ERC-20 metadata so non-native token addresses resolve
// without an on-chain read. Tests override per-case where needed.
const mockReadErc20Metadata = vi.fn(async (_slug: string, address: string) => ({
  address,
  symbol: "TKN",
  name: "Token",
  decimals: 18,
  isNative: false as const,
}));

vi.mock("@tools/kyberswap/evm-utils.js", () => ({
  getKyberEvmClients: () => ({
    publicClient: {},
    walletClient: {},
  }),
  ensureKyberAllowance: vi.fn().mockResolvedValue(undefined),
  ensureErc721Approval: vi.fn().mockResolvedValue(null),
  ensureErc1155ApprovalForAll: vi.fn().mockResolvedValue(null),
  sendKyberTransaction: vi.fn().mockResolvedValue("0xmockhash"),
  sendKyberTransactionWithReceipt: vi.fn().mockResolvedValue({
    hash: "0xzaphash",
    receipt: { logs: [{ topics: ["0xddf252ad"], data: "0x" }] },
  }),
  extractMintedNftId: (...args: unknown[]) => mockExtractMintedNftId(...args),
  extractErc1155Position: (...args: unknown[]) => mockExtractErc1155Position(...args),
  readErc20Metadata: (...args: [string, string]) => mockReadErc20Metadata(...args),
  verifyRouterAddress: vi.fn(),
}));

// Mock token API for safety gate + quote-time safety surfacing (Stage 6b).
// Shared spy so individual tests can drive honeypot/FoT/check-failed scenarios.
const mockGetHoneypotFotInfo = vi.fn().mockResolvedValue({ isHoneypot: false, isFOT: false, tax: 0 });

vi.mock("@tools/kyberswap/token-api/client.js", () => ({
  getKyberTokenApiClient: () => ({
    searchTokens: vi.fn().mockResolvedValue([]),
    getHoneypotFotInfo: (...args: [number, string]) => mockGetHoneypotFotInfo(...args),
  }),
}));

// Mock aggregator client so the read-only quote can fetch a route hermetically.
const mockGetRoute = vi.fn();

vi.mock("@tools/kyberswap/aggregator/client.js", () => ({
  getKyberAggregatorClient: () => ({
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
  }),
}));

// Spy on logger.warn so the fail-soft safety leg's log payload can be asserted
// to contain NO raw provider/HTTP text (Stage 6b fix 1). Other methods are
// no-ops to keep tests hermetic and quiet.
const mockLoggerWarn = vi.fn();

vi.mock("@utils/logger.js", () => {
  const stub = {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
  return { default: stub, logger: stub };
});

import { KYBERSWAP_HANDLERS } from "../../../vex-agent/tools/protocols/kyberswap/handlers.js";
import { KYBERSWAP_TOOLS } from "../../../vex-agent/tools/protocols/kyberswap/manifest.js";

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

  it("handler count matches manifest count (20)", () => {
    expect(Object.keys(KYBERSWAP_HANDLERS)).toHaveLength(20);
  });

  it("every handler is a function", () => {
    for (const [, handler] of Object.entries(KYBERSWAP_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // ── Required param validation ────────────────────────────────────

  it("kyberswap.tokens.check fails without chain and address", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.tokens.check"]!(
      {},
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.swap.quote fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.swap.sell fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.sell"]!(
      { chain: "ethereum", tokenIn: "ETH" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.swap.buy fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.buy"]!(
      { chain: "ethereum", tokenIn: "USDC" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.list fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.list"]!(
      {},
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.limitOrder.activeMakingAmount fails without chain and makerAsset", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.activeMakingAmount"]!(
      { chain: "ethereum" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("makerAsset");
  });

  it("kyberswap.limitOrder.create fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.create"]!(
      { chain: "ethereum", makerAsset: "USDC" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.cancel fails without chain and orderId", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.cancel"]!(
      { chain: "ethereum" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("orderId");
  });

  it("kyberswap.limitOrder.hardCancel fails without chain and orderId", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.hardCancel"]!(
      {},
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.limitOrder.pairs fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.pairs"]!(
      {},
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.limitOrder.fill fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.fill"]!(
      { chain: "ethereum", orderId: 123 },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.batchFill fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.batchFill"]!(
      { chain: "ethereum" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.limitOrder.cancelAll fails without chain", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.limitOrder.cancelAll"]!(
      {},
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain");
  });

  it("kyberswap.zap.in fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.in"]!(
      { chain: "ethereum", dex: "uniswapv3" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.zap.out fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.out"]!(
      { chain: "ethereum" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.zap.migrate fails without required params", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.migrate"]!(
      { chain: "ethereum", dexFrom: "uniswapv3" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  // ── Read-only handlers return data (no wallet needed) ────────────

  it("kyberswap.chains returns chain list", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.chains"]!(
      {},
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(20);
    expect(data[0].slug).toBeDefined();
    expect(data[0].chainId).toBeDefined();
    expect(data[0].aggregator).toBeDefined();
  });

  // ── positionRef rename ──────────────────────────────────────────

  it("kyberswap.zap.out fails with old positionId param name", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.out"]!(
      { chain: "polygon", dex: "DEX_UNISWAPV3", pool: "0xPool", positionId: "123", tokenOut: "0xToken" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("kyberswap.zap.migrate fails with old positionId param name", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.migrate"]!(
      { chain: "polygon", dexFrom: "DEX_UNISWAPV3", dexTo: "DEX_UNISWAPV3", poolFrom: "0xA", poolTo: "0xB", positionId: "123" },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  // ── source-only / TBD rejection ───────────────────────────────

  it("kyberswap.zap.in rejects unknown DEX", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.in"]!(
      {
        chain: "polygon", dex: "DEX_NONEXISTENT", pool: "0xPool",
        tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", amountIn: "100",
      },
      ctx({ sessionPermission: "restricted", approved: false }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown DEX");
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
      ctx({ sessionPermission: "full", approved: true }),
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

  // ── zap.migrate emits 2 capture items (R6) ────────────────────

  it("kyberswap.zap.migrate emits close + open capture items with different positionKeys", async () => {
    mockGetZapMigrateRoute.mockResolvedValueOnce({
      data: {
        route: "encoded-route",
        routerAddress: "0x0e97c887b61ccd952a53578b04763e7134429e05",
        zapDetails: { finalAmountUsd: "100.00", actions: [] },
      },
    });
    mockBuildZapMigrate.mockResolvedValueOnce({
      data: {
        routerAddress: "0x0e97c887b61ccd952a53578b04763e7134429e05",
        callData: "0xdeadbeef",
        value: "0",
      },
    });
    mockExtractMintedNftId.mockReturnValueOnce("99999");

    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.migrate"]!(
      {
        chain: "polygon", dexFrom: "DEX_UNISWAPV3", dexTo: "DEX_UNISWAPV3",
        poolFrom: "0xB6e57ed85c4c9dbfEF2a68711e9d6f36c56e0FcB", poolTo: "0xA374094527e1673A86dE625aa7147BeE868d0D1a",
        sourcePositionRef: "12345",
      },
      ctx({ sessionPermission: "full", approved: true }),
    );

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    const items = data._tradeCaptureItems as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);

    // First item: close source
    expect((items[0].meta as Record<string, unknown>).action).toBe("zap-out");
    expect(items[0].positionKey).toBe("12345"); // sourcePositionKey = NFT tokenId

    // Second item: open destination
    expect((items[1].meta as Record<string, unknown>).action).toBe("zap-in");
    expect(items[1].positionKey).toBe("99999"); // newPositionKey from receipt
    expect(items[1].instrumentKey).toBe("polygon:lp:0xA374094527e1673A86dE625aa7147BeE868d0D1a");
  });

  // ── zap.out uses approval target from catalog (R1) ─────────────

  it("kyberswap.zap.out resolves approval target from DEX entry", async () => {
    mockGetZapOutRoute.mockResolvedValueOnce({
      data: {
        route: "encoded-route",
        routerAddress: "0x0e97c887b61ccd952a53578b04763e7134429e05",
        zapDetails: { finalAmountUsd: "50.00", actions: [] },
      },
    });
    mockBuildZapOut.mockResolvedValueOnce({
      data: {
        routerAddress: "0x0e97c887b61ccd952a53578b04763e7134429e05",
        callData: "0xdeadbeef",
        value: "0",
      },
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.out"]!(
      {
        chain: "polygon", dex: "DEX_UNISWAPV3", pool: "0xB6e57ed85c4c9dbfEF2a68711e9d6f36c56e0FcB",
        positionRef: "12345",
        tokenOut: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      },
      ctx({ sessionPermission: "full", approved: true }),
    );

    expect(result.success).toBe(true);
    // ensureErc721Approval should have been called (ERC-721 DEX)
    const { ensureErc721Approval } = await import("@tools/kyberswap/evm-utils.js");
    expect(ensureErc721Approval).toHaveBeenCalled();
  });
});

// ── Per-session signing wallet (5D-protocols p1) ─────────────────

describe("kyberswap session wallet resolution", () => {
  const SESSION_CTX = ctx({
    walletResolution: { source: "session", evm: { id: "w-evm-1", address: SESSION_EVM.address }, solana: null },
    walletPolicy: { kind: "none" },
  });

  beforeEach(() => {
    mockResolveSigningWallet.mockClear();
    mockResolveSelectedAddress.mockClear();
  });

  it("zap.in resolves the SESSION signing wallet (not the zero-arg primary)", async () => {
    mockGetZapInRoute.mockResolvedValueOnce({
      data: { route: { r: 1 }, routerAddress: "0x2f1E23e0A5A56e7746E1Ae42d5c3112B2d0cf09B", zapDetails: { initialAmountUsd: "10.00", actions: [] } },
    });
    mockBuildZapIn.mockResolvedValueOnce({
      data: { routerAddress: "0x2f1E23e0A5A56e7746E1Ae42d5c3112B2d0cf09B", callData: "0xabcd", value: "0" },
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.in"]!(
      { chain: "polygon", dex: "DEX_UNISWAPV3", pool: "0xPool", tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", amountIn: "1000000000000000000" },
      SESSION_CTX,
    );

    expect(result.success).toBe(true);
    // Signer resolved from the SESSION resolution + policy, family eip155.
    expect(mockResolveSigningWallet).toHaveBeenCalledWith(
      SESSION_CTX.walletResolution, SESSION_CTX.walletPolicy, "eip155",
    );
  });

  it("zap.in dryRun (preview) does NOT decrypt a signing wallet", async () => {
    mockGetZapInRoute.mockResolvedValueOnce({
      data: { route: { r: 1 }, routerAddress: "0x2f1E23e0A5A56e7746E1Ae42d5c3112B2d0cf09B", zapDetails: { initialAmountUsd: "10.00", actions: [] } },
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.zap.in"]!(
      { chain: "polygon", dex: "DEX_UNISWAPV3", pool: "0xPool", tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", amountIn: "1000000000000000000", dryRun: true },
      SESSION_CTX,
    );

    expect(result.success).toBe(true);
    expect(mockResolveSigningWallet).not.toHaveBeenCalled();
  });
});

// ── Read-only token safety surfacing in kyberswap.swap.quote (Stage 6b) ──
//
// The quote attaches a `safety` block lifting honeypot/FoT risk per leg. It is
// informational only: a honeypot or failed check NEVER aborts the quote (gating
// stays in executeKyberSwap). Native legs are marked, not checked. Failures are
// swallowed into a bounded marker with no raw provider text.

describe("kyberswap.swap.quote token safety (Stage 6b)", () => {
  const TOKEN_A = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC-like
  const TOKEN_B = "0xdAC17F958D2ee523a2206206994597C13D831ec7"; // USDT-like
  const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const READ_CTX = ctx({ sessionPermission: "restricted", approved: false });

  beforeEach(() => {
    mockGetHoneypotFotInfo.mockReset();
    mockGetHoneypotFotInfo.mockResolvedValue({ isHoneypot: false, isFOT: false, tax: 0 });
    mockGetRoute.mockReset();
    mockGetRoute.mockResolvedValue({
      data: {
        routeSummary: { amountIn: "1000000", amountOut: "999000", gasUsd: "0.5" },
        routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
      },
    });
    mockReadErc20Metadata.mockReset();
    mockReadErc20Metadata.mockImplementation(async (_slug: string, address: string) => ({
      address,
      symbol: "TKN",
      name: "Token",
      decimals: 18,
      isNative: false as const,
    }));
    mockLoggerWarn.mockClear();
  });

  it("surfaces a clean safety block for both non-native legs (isHoneypot false)", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1" },
      READ_CTX,
    );

    expect(result.success).toBe(true);
    const out = JSON.parse(result.output);
    expect(out.safety).toEqual({
      tokenIn: { isHoneypot: false, isFOT: false, tax: 0 },
      tokenOut: { isHoneypot: false, isFOT: false, tax: 0 },
    });
    // Both non-native legs were checked, in parallel.
    expect(mockGetHoneypotFotInfo).toHaveBeenCalledTimes(2);
    // Routing/amounts untouched by the additive field.
    expect(out.routeSummary).toEqual({ amountIn: "1000000", amountOut: "999000", gasUsd: "0.5" });
    expect(out.routerAddress).toBe("0x6131B5fae19EA4f9D964eAc0408E4408b66337b5");
  });

  it("surfaces a honeypot tokenOut WITHOUT aborting the quote", async () => {
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_B.toLowerCase()) {
        return { isHoneypot: true, isFOT: false, tax: 0 };
      }
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1" },
      READ_CTX,
    );

    // Quote STILL returns — read-only, no gate.
    expect(result.success).toBe(true);
    const out = JSON.parse(result.output);
    expect(out.safety.tokenOut).toEqual({ isHoneypot: true, isFOT: false, tax: 0 });
    expect(out.safety.tokenIn).toEqual({ isHoneypot: false, isFOT: false, tax: 0 });
    // Route is still present — execution path untouched.
    expect(out.routeSummary).toBeDefined();
  });

  it("surfaces a fee-on-transfer / tax token in the safety block", async () => {
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_A.toLowerCase()) {
        return { isHoneypot: false, isFOT: true, tax: 12 };
      }
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1" },
      READ_CTX,
    );

    expect(result.success).toBe(true);
    const out = JSON.parse(result.output);
    expect(out.safety.tokenIn).toEqual({ isHoneypot: false, isFOT: true, tax: 12 });
  });

  it("fail-soft: a thrown honeypot check yields a bounded marker, quote still returns, no raw text", async () => {
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_B.toLowerCase()) {
        // Raw provider text that MUST NOT leak into the output.
        throw new Error("Honeypot check failed: 503 https://token-api.kyberswap.com/secret?key=ABC <html>boom</html>");
      }
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1" },
      READ_CTX,
    );

    // Quote still returns despite the failed check.
    expect(result.success).toBe(true);
    const out = JSON.parse(result.output);
    // Bounded marker — checkFailed plus a bounded reason class (no raw text).
    expect(out.safety.tokenOut.checkFailed).toBe(true);
    expect(["timeout", "rate_limited", "kyber_error", "unavailable"]).toContain(out.safety.tokenOut.reason);
    expect(out.safety.tokenIn).toEqual({ isHoneypot: false, isFOT: false, tax: 0 });
    // No raw provider/HTTP text anywhere in the serialized output.
    expect(result.output).not.toContain("kyberswap.com");
    expect(result.output).not.toContain("<html>");
    expect(result.output).not.toContain("key=ABC");
    expect(result.output).not.toContain("503");
  });

  it("fix 1: the safety_check_failed LOG payload carries a bounded reason class only (no raw text)", async () => {
    // Raw provider text with every forbidden token class: URL, doctype/html,
    // apiKey/sk_live secret, and a numeric HTTP status.
    const RAW =
      "Honeypot check failed: 503 https://token-api.kyberswap.com/x?apiKey=sk_live_ABC <!DOCTYPE html><html>boom</html>";
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_B.toLowerCase()) throw new Error(RAW);
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1" },
      READ_CTX,
    );
    expect(result.success).toBe(true);

    // logger.warn was invoked for the failed leg; its payload must be bounded.
    expect(mockLoggerWarn).toHaveBeenCalled();
    const warnCall = mockLoggerWarn.mock.calls.find(
      (c) => c[0] === "kyberswap.swap.quote.safety_check_failed",
    );
    expect(warnCall).toBeDefined();
    const payload = warnCall![1] as Record<string, unknown>;
    // reason is one of the four bounded literals.
    expect(["timeout", "rate_limited", "kyber_error", "unavailable"]).toContain(payload.reason);

    // The serialized payload contains NONE of the forbidden raw-text classes.
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain("http://");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("kyberswap.com");
    expect(serialized).not.toContain("<!doctype");
    expect(serialized).not.toContain("html");
    expect(serialized).not.toContain("apikey=");
    expect(serialized).not.toContain("sk_live");
    expect(serialized).not.toContain("503");
  });

  it("fix 2: the native SENTINEL ADDRESS leg is marked { native: true } and is never honeypot-checked", async () => {
    // Pass the sentinel ADDRESS (not the "ETH" keyword) as tokenIn.
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum", tokenIn: NATIVE, tokenOut: TOKEN_B, amountIn: "1" },
      READ_CTX,
    );

    expect(result.success).toBe(true);
    const out = JSON.parse(result.output);
    // Sentinel resolved as native — safety leg is the native marker.
    expect(out.safety.tokenIn).toEqual({ native: true });
    expect(out.tokenIn.address).toBe(NATIVE);
    expect(out.safety.tokenOut).toEqual({ isHoneypot: false, isFOT: false, tax: 0 });
    // Only the non-native (tokenOut) leg was honeypot-checked.
    expect(mockGetHoneypotFotInfo).toHaveBeenCalledTimes(1);
    expect(mockGetHoneypotFotInfo).toHaveBeenCalledWith(1, TOKEN_B);
    // Sentinel never went through the ERC-20 metadata read path.
    expect(mockReadErc20Metadata).not.toHaveBeenCalledWith(expect.anything(), NATIVE);
    // Route still returns.
    expect(out.routeSummary).toBeDefined();
  });

  it("skips native legs — marks { native: true } and does not call the honeypot check for them", async () => {
    const result = await KYBERSWAP_HANDLERS["kyberswap.swap.quote"]!(
      { chain: "ethereum", tokenIn: "ETH", tokenOut: TOKEN_B, amountIn: "1" },
      READ_CTX,
    );

    expect(result.success).toBe(true);
    const out = JSON.parse(result.output);
    expect(out.safety.tokenIn).toEqual({ native: true });
    expect(out.safety.tokenOut).toEqual({ isHoneypot: false, isFOT: false, tax: 0 });
    // Only the non-native (tokenOut) leg was checked.
    expect(mockGetHoneypotFotInfo).toHaveBeenCalledTimes(1);
    expect(mockGetHoneypotFotInfo).toHaveBeenCalledWith(1, TOKEN_B);
  });
});

// ── executeKyberSwap inline safety gate (broadcast path, FIX 1) ──────────────
//
// Owner doctrine (Stage 9): the ONLY hard safety block for an EVM swap is a
// CONFIRMED honeypot (`isHoneypot === true`). Fee-on-transfer / high tax is the
// model's decision (warn-only), and a THROWN safety check (API down/429/timeout)
// must NOT abort a legit trade — it logs ONE bounded reason class and proceeds.
//
// We exercise the gate through `kyberswap.swap.sell` with `dryRun: true`: the
// executor runs the safety gate, then fetches the route, then short-circuits at
// the dryRun return BEFORE any signer decrypt / allowance / broadcast. So
// "reached the dryRun route step" == "the safety gate did NOT abort", and a
// `success: false` with an "Aborting" message == "the safety gate blocked".
// This proves early-return-vs-proceed without mocking the full broadcast.

describe("executeKyberSwap inline safety gate (FIX 1, broadcast path)", () => {
  const TOKEN_A = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC-like
  const TOKEN_B = "0xdAC17F958D2ee523a2206206994597C13D831ec7"; // USDT-like
  const EXEC_CTX = ctx({ sessionPermission: "full", approved: true });

  /** A swap.sell dryRun call: runs the safety gate + route, stops before broadcast. */
  function sellDryRun() {
    return KYBERSWAP_HANDLERS["kyberswap.swap.sell"]!(
      { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1", dryRun: true },
      EXEC_CTX,
    );
  }

  beforeEach(() => {
    mockGetHoneypotFotInfo.mockReset();
    mockGetHoneypotFotInfo.mockResolvedValue({ isHoneypot: false, isFOT: false, tax: 0 });
    mockGetRoute.mockReset();
    mockGetRoute.mockResolvedValue({
      data: {
        routeSummary: { amountIn: "1000000", amountOut: "999000", gasUsd: "0.5" },
        routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
      },
    });
    mockReadErc20Metadata.mockReset();
    mockReadErc20Metadata.mockImplementation(async (_slug: string, address: string) => ({
      address, symbol: "TKN", name: "Token", decimals: 18, isNative: false as const,
    }));
    mockLoggerWarn.mockClear();
  });

  it("a CONFIRMED honeypot tokenIn STILL aborts — never reaches the route step", async () => {
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_A.toLowerCase()) return { isHoneypot: true, isFOT: false, tax: 0 };
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await sellDryRun();
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/honeypot/i);
    expect(result.output).toMatch(/aborting/i);
    // Aborted before the route fetch.
    expect(mockGetRoute).not.toHaveBeenCalled();
  });

  it("a CONFIRMED honeypot tokenOut STILL aborts", async () => {
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_B.toLowerCase()) return { isHoneypot: true, isFOT: false, tax: 0 };
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await sellDryRun();
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/honeypot/i);
    expect(mockGetRoute).not.toHaveBeenCalled();
  });

  it("FoT tax > 50 does NOT abort — proceeds past the gate to the dryRun route step + warns", async () => {
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_A.toLowerCase()) return { isHoneypot: false, isFOT: true, tax: 60 };
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await sellDryRun();
    // Reached the dryRun route step → the safety gate did NOT abort on FoT.
    expect(result.success).toBe(true);
    const out = JSON.parse(result.output);
    expect(out.dryRun).toBe(true);
    expect(mockGetRoute).toHaveBeenCalledTimes(1);
    // A high-tax FoT still emits a (warn-only) structural log.
    const fotWarn = mockLoggerWarn.mock.calls.find((c) => c[0] === "kyberswap.swap.fot_warning");
    expect(fotWarn).toBeDefined();
    expect((fotWarn![1] as Record<string, unknown>).tax).toBe(60);
  });

  it("a THROWN safety check does NOT abort — proceeds + logs ONE bounded reason class (no raw text)", async () => {
    const RAW =
      "Honeypot check failed: 503 https://token-api.kyberswap.com/x?apiKey=sk_live_ABC <!DOCTYPE html><html>boom</html>";
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_A.toLowerCase()) throw new Error(RAW);
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await sellDryRun();
    // A transient external-API failure must NOT abort a legit trade.
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output).dryRun).toBe(true);
    expect(mockGetRoute).toHaveBeenCalledTimes(1);

    // ONE bounded structural warn — reason class only, never raw provider/HTTP text.
    const failWarn = mockLoggerWarn.mock.calls.find((c) => c[0] === "kyberswap.swap.safety_check_failed");
    expect(failWarn).toBeDefined();
    const payload = failWarn![1] as Record<string, unknown>;
    expect(["timeout", "rate_limited", "kyber_error", "unavailable"]).toContain(payload.reason);
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("kyberswap.com");
    expect(serialized).not.toContain("<!doctype");
    expect(serialized).not.toContain("html");
    expect(serialized).not.toContain("apikey=");
    expect(serialized).not.toContain("sk_live");
    expect(serialized).not.toContain("503");
  });

  it("a confirmed honeypot caught at execute STILL aborts even when the OTHER leg's check threw", async () => {
    // Owner residual-risk note: the execute-time honeypot gate is the hard block
    // whenever the check SUCCEEDS and returns honeypot — independent of a
    // transient failure on the other leg.
    mockGetHoneypotFotInfo.mockImplementation(async (_chainId: number, address: string) => {
      if (address.toLowerCase() === TOKEN_A.toLowerCase()) throw new Error("transient 429");
      if (address.toLowerCase() === TOKEN_B.toLowerCase()) return { isHoneypot: true, isFOT: false, tax: 0 };
      return { isHoneypot: false, isFOT: false, tax: 0 };
    });

    const result = await sellDryRun();
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/honeypot/i);
  });
});
