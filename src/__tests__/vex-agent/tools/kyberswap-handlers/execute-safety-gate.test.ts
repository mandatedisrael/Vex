import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";
import { ErrorCodes, VexError } from "../../../../errors.js";

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
const mockEnsureKyberAllowance = vi.fn();
const mockEnsureErc20Balance = vi.fn();

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
  ensureKyberAllowance: (...args: unknown[]) => mockEnsureKyberAllowance(...args),
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

vi.mock("@tools/evm-chains/erc20-balance-guard.js", () => ({
  ensureErc20Balance: (...args: unknown[]) => mockEnsureErc20Balance(...args),
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

import { KYBERSWAP_HANDLERS } from "../../../../vex-agent/tools/protocols/kyberswap/handlers.js";
import { KYBERSWAP_TOOLS } from "../../../../vex-agent/tools/protocols/kyberswap/manifest.js";

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
    mockEnsureKyberAllowance.mockReset();
    mockEnsureKyberAllowance.mockResolvedValue(undefined);
    mockEnsureErc20Balance.mockReset();
    mockEnsureErc20Balance.mockResolvedValue(undefined);
  });

  it("an insufficient input balance aborts before allowance mutation or swap build", async () => {
    mockEnsureErc20Balance.mockRejectedValue(new VexError(ErrorCodes.INSUFFICIENT_BALANCE, "short balance"));

    await expect(
      KYBERSWAP_HANDLERS["kyberswap.swap.sell"]!(
        { chain: "ethereum", tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: "1" },
        EXEC_CTX,
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.INSUFFICIENT_BALANCE });

    expect(mockEnsureKyberAllowance).not.toHaveBeenCalled();
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
