/**
 * Swap prequote module — Stage 6c unit tests.
 *
 * Pins:
 *   - Verdict (EVM): honeypot→fail, FoT tax>50→fail, FoT tax<=50→pass,
 *     checkFailed→unknown, native→ok, clean→pass, malformed leg→unknown,
 *     worst-leg aggregation.
 *   - Verdict (Solana): isSus:true→fail, isSus:false→pass, absent entry for
 *     non-native mint→unknown, native/wSOL leg→ok, worst-leg aggregation.
 *   - Match-hash: determinism; EVM lowercases address+wallet; Solana preserves
 *     mint case; "1.0" vs "1" collide; slippage does NOT change the hash;
 *     session/wallet/token/amount DO change it.
 *   - Recording: EVM-shaped result writes a row with expected verdict/identity;
 *     Solana-shaped result writes; malformed result records nothing without
 *     throwing; a resolveSelectedAddress throw records nothing without throwing.
 *   - Gate (Stage 7): allow/block matrix, guardrail #1 (fresh fail never slips),
 *     R1 kind-isolation, R2 EVM native canon + bare-symbol block, EVM/Solana
 *     quote→execute hash collision, R3 fail-closed (DB throw / resolve throw /
 *     no session → bounded block, no raw text).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { createHash } from "node:crypto";

import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";
import { NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import { VexError, ErrorCodes } from "../../../../errors.js";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";
import type { SwapPrequote, SafetyVerdict } from "@vex-agent/db/repos/swap-prequotes.js";

// ── Mocks ─────────────────────────────────────────────────────────────────

type CreateMock = Mock<(input: unknown) => Promise<void>>;
type ResolveMock = Mock<(...args: unknown[]) => string>;
type FindMock = Mock<(s: string, h: string, k: string) => Promise<SwapPrequote | null>>;
type ExistsMock = Mock<(s: string, h: string, k: string) => Promise<boolean>>;
type JupiterMock = Mock<(q: string) => Promise<{ address: string }>>;

let mockCreate: CreateMock;
let mockResolveSelectedAddress: ResolveMock;
let mockFindLatest: FindMock;
let mockExistsFail: ExistsMock;
let mockRequireJupiter: JupiterMock;

function resetMocks() {
  mockCreate = vi.fn<(input: unknown) => Promise<void>>().mockResolvedValue(undefined);
  mockResolveSelectedAddress = vi
    .fn<(...args: unknown[]) => string>()
    .mockReturnValue("0xWALLET");
  mockFindLatest = vi
    .fn<(s: string, h: string, k: string) => Promise<SwapPrequote | null>>()
    .mockResolvedValue(null);
  mockExistsFail = vi
    .fn<(s: string, h: string, k: string) => Promise<boolean>>()
    .mockResolvedValue(false);
  // Default Solana resolver: identity (mint passed through) — tests override.
  mockRequireJupiter = vi
    .fn<(q: string) => Promise<{ address: string }>>()
    .mockImplementation(async (q: string) => ({ address: q }));
}
resetMocks();

vi.mock("@vex-agent/db/repos/swap-prequotes.js", () => ({
  create: (input: unknown) => mockCreate(input),
  findLatestFreshByMatch: (s: string, h: string, k: string) => mockFindLatest(s, h, k),
  existsFreshFailByMatch: (s: string, h: string, k: string) => mockExistsFail(s, h, k),
}));

vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: (...args: unknown[]) => mockResolveSelectedAddress(...args),
}));

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js", () => ({
  requireJupiterResolvedToken: (q: string) => mockRequireJupiter(q),
}));

const mod = await import("@vex-agent/tools/protocols/swap-prequote.js");

/** Build a full SwapPrequote row stub with a given verdict (gate reads only a few fields). */
function prequoteRow(verdict: SafetyVerdict, overrides: Partial<SwapPrequote> = {}): SwapPrequote {
  return {
    prequoteId: "prequote-row-1",
    sessionId: SESSION_ID,
    matchHash: "h".repeat(64),
    kind: "swap",
    family: "eip155",
    provider: "kyberswap",
    chainId: 8453,
    walletAddress: "0xWALLET",
    tokenIn: EVM_TOKEN_IN,
    tokenOut: EVM_TOKEN_OUT,
    amount: "1",
    slippageBps: 50,
    safetyVerdict: verdict,
    safetyDetail: {},
    routeRef: null,
    createdAt: "2026-06-04T10:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
});

// ── Fixtures ────────────────────────────────────────────────────────────

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const EVM_TOKEN_IN = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EVM_TOKEN_OUT = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const SOLANA_MINT_A = "FooMintCaseSensitiveABC123";
const SOLANA_MINT_B = "BarMintCaseSensitiveXYZ789";

function ctx(overrides: Partial<ProtocolExecutionContext> = {}): ProtocolExecutionContext {
  return {
    sessionPermission: "full",
    approved: true,
    walletResolution: { source: "default" },
    walletPolicy: { kind: "none" },
    sessionId: SESSION_ID,
    ...overrides,
  };
}

// EVM kyberswap.swap.quote result.data builder.
function evmResult(
  tokenInLeg: Record<string, unknown>,
  tokenOutLeg: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    chain: "base",
    chainId: 8453,
    tokenIn: { address: EVM_TOKEN_IN, symbol: "AAA", decimals: 18 },
    tokenOut: { address: EVM_TOKEN_OUT, symbol: "BBB", decimals: 18 },
    routeSummary: { foo: "bar" },
    routerAddress: "0xROUTER",
    safety: { tokenIn: tokenInLeg, tokenOut: tokenOutLeg },
    ...overrides,
  };
}

// Solana solana.swap.quote result.data builder.
function solanaResult(
  inMint: string,
  outMint: string,
  safety: Record<string, unknown> | undefined,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    inputToken: { chain: "solana", address: inMint, symbol: "IN", name: "In", decimals: 6 },
    outputToken: { chain: "solana", address: outMint, symbol: "OUT", name: "Out", decimals: 6 },
    inputAmountRaw: "1000000",
    slippageBps: 50,
    requestId: "req-1",
    ...overrides,
  };
  if (safety !== undefined) base.safety = safety;
  return base;
}

// ── EVM verdict ─────────────────────────────────────────────────────────

describe("verdict — EVM (kyberswap.swap.quote)", () => {
  function verdictOf(inLeg: Record<string, unknown>, outLeg: Record<string, unknown>): string | undefined {
    return mod.extractQuote("kyberswap.swap.quote", { amountIn: "1" }, evmResult(inLeg, outLeg))?.verdict;
  }

  it("honeypot leg → fail", () => {
    expect(verdictOf({ isHoneypot: true, isFOT: false, tax: 0 }, { native: true })).toBe("fail");
  });

  it("FoT with tax > 50 → fail", () => {
    expect(verdictOf({ isHoneypot: false, isFOT: true, tax: 60 }, { native: true })).toBe("fail");
  });

  it("FoT with tax <= 50 → pass (info-only, not a fail)", () => {
    expect(verdictOf({ isHoneypot: false, isFOT: true, tax: 50 }, { native: true })).toBe("pass");
    expect(verdictOf({ isHoneypot: false, isFOT: true, tax: 10 }, { native: true })).toBe("pass");
  });

  it("checkFailed leg → unknown (fail-closed)", () => {
    expect(verdictOf({ checkFailed: true, reason: "timeout" }, { native: true })).toBe("unknown");
  });

  it("native leg → does not worsen (clean other leg → pass)", () => {
    expect(verdictOf({ native: true }, { isHoneypot: false, isFOT: false, tax: 0 })).toBe("pass");
  });

  it("clean audited legs → pass", () => {
    expect(
      verdictOf(
        { isHoneypot: false, isFOT: false, tax: 0 },
        { isHoneypot: false, isFOT: false, tax: 0 },
      ),
    ).toBe("pass");
  });

  it("malformed leg shape → whole extraction fails (null)", () => {
    // A leg that matches none of the three shapes fails the safety schema, so
    // the EVM result no longer structurally validates → extraction returns null.
    const result = mod.extractQuote(
      "kyberswap.swap.quote",
      { amountIn: "1" },
      evmResult({ bogus: 1 }, { native: true }),
    );
    expect(result).toBeNull();
  });

  it("worst-leg aggregation: clean + honeypot → fail", () => {
    expect(
      verdictOf({ isHoneypot: false, isFOT: false, tax: 0 }, { isHoneypot: true, isFOT: false, tax: 0 }),
    ).toBe("fail");
  });

  it("worst-leg aggregation: clean + checkFailed → unknown", () => {
    expect(
      verdictOf({ isHoneypot: false, isFOT: false, tax: 0 }, { checkFailed: true, reason: "unavailable" }),
    ).toBe("unknown");
  });

  it("worst-leg aggregation: fail dominates unknown", () => {
    expect(
      verdictOf({ checkFailed: true, reason: "timeout" }, { isHoneypot: true, isFOT: false, tax: 0 }),
    ).toBe("fail");
  });

  it("safety_detail carries bounded fields only", () => {
    const extracted = mod.extractQuote(
      "kyberswap.swap.quote",
      { amountIn: "1" },
      evmResult({ isHoneypot: false, isFOT: true, tax: 12 }, { native: true }),
    );
    expect(extracted?.safetyDetail).toEqual({
      tokenIn: { isHoneypot: false, isFOT: true, tax: 12 },
      tokenOut: { native: true },
    });
  });

  it("checkFailed detail surfaces only a bounded reason class", () => {
    const extracted = mod.extractQuote(
      "kyberswap.swap.quote",
      { amountIn: "1" },
      evmResult({ checkFailed: true, reason: "rate_limited" }, { native: true }),
    );
    expect(extracted?.safetyDetail).toEqual({
      tokenIn: { checkFailed: true, reason: "rate_limited" },
      tokenOut: { native: true },
    });
  });
});

// ── Solana verdict ──────────────────────────────────────────────────────

describe("verdict — Solana (solana.swap.quote)", () => {
  function verdictOf(
    inMint: string,
    outMint: string,
    safety: Record<string, unknown> | undefined,
  ): string | undefined {
    return mod.extractQuote("solana.swap.quote", { amount: 1 }, solanaResult(inMint, outMint, safety))?.verdict;
  }

  it("isSus:true → fail", () => {
    expect(
      verdictOf(SOLANA_MINT_A, SOL_MINT, { inputToken: { isSus: true } }),
    ).toBe("fail");
  });

  it("isSus:false → pass", () => {
    expect(
      verdictOf(SOLANA_MINT_A, SOL_MINT, { inputToken: { isSus: false } }),
    ).toBe("pass");
  });

  it("absent entry for a non-native mint → unknown (fail-closed)", () => {
    // Trade between two non-native mints, no safety block at all.
    expect(verdictOf(SOLANA_MINT_A, SOLANA_MINT_B, undefined)).toBe("unknown");
  });

  it("absent entry for ONE non-native leg → unknown", () => {
    // input audited clean, output non-native but no entry → unknown.
    expect(
      verdictOf(SOLANA_MINT_A, SOLANA_MINT_B, { inputToken: { isSus: false } }),
    ).toBe("unknown");
  });

  it("native SOL/wSOL leg → does not worsen (other leg clean → pass)", () => {
    expect(
      verdictOf(SOL_MINT, SOLANA_MINT_A, { outputToken: { isSus: false } }),
    ).toBe("pass");
  });

  it("both legs native → pass even with no safety block", () => {
    // wSOL→wSOL is degenerate but must not be unknown.
    expect(verdictOf(SOL_MINT, SOL_MINT, undefined)).toBe("pass");
  });

  it("worst-leg aggregation: clean + isSus:true → fail", () => {
    expect(
      verdictOf(SOLANA_MINT_A, SOLANA_MINT_B, {
        inputToken: { isSus: false },
        outputToken: { isSus: true },
      }),
    ).toBe("fail");
  });

  it("present entry with null isSus → unknown (no verdict signal)", () => {
    expect(
      verdictOf(SOLANA_MINT_A, SOL_MINT, { inputToken: { mintAuthorityDisabled: true } }),
    ).toBe("unknown");
  });

  it("safety_detail carries bounded audited fields", () => {
    const extracted = mod.extractQuote(
      "solana.swap.quote",
      { amount: 1 },
      solanaResult(SOLANA_MINT_A, SOL_MINT, {
        inputToken: { isSus: false, mintAuthorityDisabled: true, topHoldersPercentage: 12.5 },
      }),
    );
    expect(extracted?.safetyDetail).toEqual({
      inputToken: { isSus: false, mintAuthorityDisabled: true, topHoldersPercentage: 12.5 },
      outputToken: { native: true },
    });
  });
});

// ── Match-hash ──────────────────────────────────────────────────────────

describe("computePrequoteMatchHash", () => {
  const base = {
    kind: "swap" as const,
    sessionId: SESSION_ID,
    family: "eip155" as const,
    chainId: 8453,
    walletAddress: "0xWALLET",
    tokenIn: EVM_TOKEN_IN,
    tokenOut: EVM_TOKEN_OUT,
    amount: "1.0",
  };

  it("is deterministic", () => {
    expect(mod.computePrequoteMatchHash(base)).toBe(mod.computePrequoteMatchHash({ ...base }));
  });

  it("produces a full sha256 hex digest (64 lowercase hex chars)", () => {
    expect(mod.computePrequoteMatchHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("EVM lowercases the wallet address + token addresses", () => {
    const lower = mod.computePrequoteMatchHash(base);
    const upper = mod.computePrequoteMatchHash({
      ...base,
      walletAddress: "0xWALLET".toUpperCase(),
      tokenIn: EVM_TOKEN_IN.toUpperCase(),
      tokenOut: EVM_TOKEN_OUT.toUpperCase(),
    });
    expect(upper).toBe(lower);
  });

  it("Solana preserves mint case (base58 is case-sensitive)", () => {
    const solBase = {
      kind: "swap" as const,
      sessionId: SESSION_ID,
      family: "solana" as const,
      chainId: null,
      walletAddress: "SolWalletAddr",
      tokenIn: SOLANA_MINT_A,
      tokenOut: SOL_MINT,
      amount: "1",
    };
    const original = mod.computePrequoteMatchHash(solBase);
    const lowered = mod.computePrequoteMatchHash({ ...solBase, tokenIn: SOLANA_MINT_A.toLowerCase() });
    expect(lowered).not.toBe(original);
  });

  it('"1.0" and "1" (and "1.00", " 1 ") collide', () => {
    const h1 = mod.computePrequoteMatchHash({ ...base, amount: "1.0" });
    expect(mod.computePrequoteMatchHash({ ...base, amount: "1" })).toBe(h1);
    expect(mod.computePrequoteMatchHash({ ...base, amount: "1.00" })).toBe(h1);
    expect(mod.computePrequoteMatchHash({ ...base, amount: " 1 " })).toBe(h1);
    expect(mod.computePrequoteMatchHash({ ...base, amount: "01" })).toBe(h1);
  });

  it("distinct amounts produce distinct hashes", () => {
    expect(mod.computePrequoteMatchHash({ ...base, amount: "2" })).not.toBe(
      mod.computePrequoteMatchHash({ ...base, amount: "1" }),
    );
  });

  it("different session / wallet / token change the hash", () => {
    const h = mod.computePrequoteMatchHash(base);
    expect(mod.computePrequoteMatchHash({ ...base, sessionId: "other" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...base, walletAddress: "0xOTHER" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...base, tokenIn: "0xCAFE" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...base, tokenOut: "0xCAFE" })).not.toBe(h);
  });

  it("EVM chainId is part of the hash; Solana uses empty chain slot", () => {
    const evm = mod.computePrequoteMatchHash(base);
    const evmOtherChain = mod.computePrequoteMatchHash({ ...base, chainId: 1 });
    expect(evmOtherChain).not.toBe(evm);
    // Solana: chainId is ignored (always ""), so two solana inputs with the
    // same identity collide regardless of any chainId value passed.
    const sol1 = mod.computePrequoteMatchHash({ ...base, family: "solana", chainId: null });
    const sol2 = mod.computePrequoteMatchHash({ ...base, family: "solana", chainId: 999 });
    expect(sol1).toBe(sol2);
  });

  it("matches an explicit reference digest (composition is stable)", () => {
    const expected = createHash("sha256")
      .update(
        [
          "swap",
          SESSION_ID,
          "eip155",
          "8453",
          "0xwallet",
          EVM_TOKEN_IN.toLowerCase(),
          EVM_TOKEN_OUT.toLowerCase(),
          "1",
        ].join(" "),
      )
      .digest("hex");
    expect(mod.computePrequoteMatchHash(base)).toBe(expected);
  });
});

// ── Recording ───────────────────────────────────────────────────────────

describe("recordPrequoteFromQuote", () => {
  it("writes a row for a successful EVM quote with expected verdict + identity", async () => {
    // Mixed-case checksum-style address — stored verbatim; only the hash lowercases.
    const evmWallet = "0xDeAdBeEf00000000000000000000000000001234";
    mockResolveSelectedAddress.mockReturnValue(evmWallet);
    await mod.recordPrequoteFromQuote(
      "kyberswap.swap.quote",
      { amountIn: "1.0", slippageBps: 30 },
      evmResult({ isHoneypot: false, isFOT: false, tax: 0 }, { native: true }),
      ctx(),
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const input = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.sessionId).toBe(SESSION_ID);
    expect(input.kind).toBe("swap");
    expect(input.family).toBe("eip155");
    expect(input.provider).toBe("kyberswap");
    expect(input.chainId).toBe(8453);
    expect(input.tokenIn).toBe(EVM_TOKEN_IN);
    expect(input.tokenOut).toBe(EVM_TOKEN_OUT);
    expect(input.amount).toBe("1.0");
    expect(input.slippageBps).toBe(30);
    expect(input.safetyVerdict).toBe("pass");
    // Wallet address is stored VERBATIM (mixed case preserved); only the hash
    // lowercases EVM addresses.
    expect(input.walletAddress).toBe(evmWallet);
    expect(typeof input.prequoteId).toBe("string");
    expect(String(input.prequoteId).startsWith("prequote-")).toBe(true);
    // match_hash must equal the exported pure function on the SAME identity.
    expect(input.matchHash).toBe(
      mod.computePrequoteMatchHash({
        kind: "swap",
        sessionId: SESSION_ID,
        family: "eip155",
        chainId: 8453,
        walletAddress: evmWallet,
        tokenIn: EVM_TOKEN_IN,
        tokenOut: EVM_TOKEN_OUT,
        amount: "1.0",
      }),
    );
    // expires_at is in the future.
    expect(new Date(String(input.expiresAt)).getTime()).toBeGreaterThan(Date.now());
  });

  it("writes a row for a successful Solana quote", async () => {
    mockResolveSelectedAddress.mockReturnValue("SolWalletAddr");
    await mod.recordPrequoteFromQuote(
      "solana.swap.quote",
      { amount: 2.5, slippageBps: 100 },
      solanaResult(SOLANA_MINT_A, SOL_MINT, { inputToken: { isSus: false } }),
      ctx(),
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const input = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.family).toBe("solana");
    expect(input.provider).toBe("jupiter");
    expect(input.chainId).toBeNull();
    expect(input.tokenIn).toBe(SOLANA_MINT_A);
    expect(input.tokenOut).toBe(SOL_MINT);
    expect(input.amount).toBe("2.5");
    expect(input.safetyVerdict).toBe("pass");
  });

  it("records nothing for a malformed result (no throw)", async () => {
    await expect(
      mod.recordPrequoteFromQuote(
        "kyberswap.swap.quote",
        { amountIn: "1" },
        { totally: "wrong" },
        ctx(),
      ),
    ).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("records nothing when resolveSelectedAddress throws (no throw, no fabricated address)", async () => {
    mockResolveSelectedAddress.mockImplementation(() => {
      throw new VexError(ErrorCodes.WALLET_NOT_SELECTED, "no wallet");
    });
    await expect(
      mod.recordPrequoteFromQuote(
        "kyberswap.swap.quote",
        { amountIn: "1" },
        evmResult({ native: true }, { native: true }),
        ctx(),
      ),
    ).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("records nothing when sessionId is absent", async () => {
    await mod.recordPrequoteFromQuote(
      "kyberswap.swap.quote",
      { amountIn: "1" },
      evmResult({ native: true }, { native: true }),
      ctx({ sessionId: undefined }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("ignores an unregistered tool id", async () => {
    await mod.recordPrequoteFromQuote(
      "kyberswap.swap.sell",
      { amountIn: "1" },
      evmResult({ native: true }, { native: true }),
      ctx(),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("swallows a DB write failure (never throws to the caller)", async () => {
    // The module owns its own "never throws" contract — a rejecting create()
    // must resolve, not propagate (the runtime caller also guards, but the
    // module must not rely on that). The throw site is reached (create called),
    // and only a bounded reason is logged.
    mockCreate.mockRejectedValueOnce(new Error("boom"));
    await expect(
      mod.recordPrequoteFromQuote(
        "kyberswap.swap.quote",
        { amountIn: "1" },
        evmResult({ isHoneypot: false, isFOT: false, tax: 0 }, { native: true }),
        ctx(),
      ),
    ).resolves.toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ── Gate (Stage 7) ──────────────────────────────────────────────────────

describe("evaluateSwapPrequoteGate", () => {
  // The gate validates EVM legs with viem `isAddress` (strict checksum, same as
  // the kyber execute handler). The all-uppercase 6c hashing fixtures are NOT
  // valid checksummed addresses, so the gate uses LOWERCASE address legs (which
  // pass strict isAddress) — these stand in for the exact address a quote
  // returned. The recorder stores a checksummed/lowercased address; the hash
  // lowercases both, so a lowercase leg here collides with a recorded leg.
  const GATE_TOKEN_IN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const GATE_TOKEN_OUT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  // Standard EVM execute params (address legs — gate-able identity).
  const EVM_PARAMS = {
    chain: "base",
    tokenIn: GATE_TOKEN_IN,
    tokenOut: GATE_TOKEN_OUT,
    amountIn: "1",
  };
  const SOL_PARAMS = { inputToken: SOLANA_MINT_A, outputToken: SOL_MINT, amount: 1 };

  // ── Decision matrix ────────────────────────────────────────────────────

  it("no fresh prequote → block(no_quote)", async () => {
    mockExistsFail.mockResolvedValue(false);
    mockFindLatest.mockResolvedValue(null);
    const d = await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(d.kind).toBe("block");
    if (d.kind === "block") {
      expect(d.reason).toBe("no_quote");
      expect(d.message).toMatch(/no fresh quote/i);
    }
  });

  it("fresh fail → block(safety_fail)", async () => {
    mockExistsFail.mockResolvedValue(true);
    const d = await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(d.kind).toBe("block");
    if (d.kind === "block") expect(d.reason).toBe("safety_fail");
    // existsFreshFail short-circuits — latest is never consulted.
    expect(mockFindLatest).not.toHaveBeenCalled();
  });

  it("fresh pass → allow(pass)", async () => {
    mockExistsFail.mockResolvedValue(false);
    mockFindLatest.mockResolvedValue(prequoteRow("pass"));
    const d = await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(d.kind).toBe("allow");
    if (d.kind === "allow") {
      expect(d.verdict).toBe("pass");
      expect(d.prequoteId).toBe("prequote-row-1");
    }
  });

  it("fresh unknown → allow(unknown) + unknown_allowed warn (prefix only)", async () => {
    const warnSpy = vi.spyOn((await import("@utils/logger.js")).default, "warn");
    mockExistsFail.mockResolvedValue(false);
    mockFindLatest.mockResolvedValue(prequoteRow("unknown"));
    const d = await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(d.kind).toBe("allow");
    if (d.kind === "allow") expect(d.verdict).toBe("unknown");
    const unknownLog = warnSpy.mock.calls.find(
      (c) => c[0] === "protocol.prequote.gate.unknown_allowed",
    );
    expect(unknownLog).toBeDefined();
    const meta = unknownLog?.[1] as Record<string, unknown>;
    // Only an 8-char prefix is logged — never the full hash or any address.
    expect(String(meta.matchHashPrefix)).toHaveLength(8);
    expect(JSON.stringify(meta)).not.toContain(GATE_TOKEN_IN);
    warnSpy.mockRestore();
  });

  // ── Guardrail #1 — a fresh fail is NEVER allowed ───────────────────────

  it("guardrail#1: a fresh fail blocks even when latest row is pass/unknown (existsFreshFail dominates)", async () => {
    // existsFreshFail returns true → block BEFORE the latest pass row is read.
    mockExistsFail.mockResolvedValue(true);
    mockFindLatest.mockResolvedValue(prequoteRow("pass"));
    const d = await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(d.kind === "block" && d.reason).toBe("safety_fail");
    expect(mockFindLatest).not.toHaveBeenCalled();
  });

  it("guardrail#1: a latest-row fail also blocks (belt-and-suspenders, existsFreshFail false)", async () => {
    // existsFreshFail false (e.g. race) but the latest row is itself a fail →
    // must still block, never allow a fail verdict through.
    mockExistsFail.mockResolvedValue(false);
    mockFindLatest.mockResolvedValue(prequoteRow("fail"));
    const d = await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(d.kind === "block" && d.reason).toBe("safety_fail");
  });

  // ── R1 kind-isolation ──────────────────────────────────────────────────

  it("R1: gate reads only the 'swap' kind (a bridge row with the same hash is invisible)", async () => {
    // The repo is mocked, so we assert the gate passes kind='swap' to BOTH
    // reads — a bridge row never reaches the swap gate (DB filters it out).
    mockExistsFail.mockResolvedValue(false);
    mockFindLatest.mockResolvedValue(null);
    const d = await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(d.kind === "block" && d.reason).toBe("no_quote");
    expect(mockExistsFail.mock.calls[0]![2]).toBe("swap");
    expect(mockFindLatest.mock.calls[0]![2]).toBe("swap");
  });

  // ── R2 EVM native canonicalization + bare-symbol block ─────────────────

  it("R2: native ETH input hashes to the same identity as the sentinel address", async () => {
    mockExistsFail.mockResolvedValue(false);
    mockFindLatest.mockResolvedValue(prequoteRow("pass"));
    await mod.evaluateSwapPrequoteGate(
      "kyberswap.swap.sell",
      { ...EVM_PARAMS, tokenIn: "ETH" },
      ctx(),
    );
    const hashFromKeyword = mockFindLatest.mock.calls[0]![1];
    resetMocks();
    mockFindLatest.mockResolvedValue(prequoteRow("pass"));
    await mod.evaluateSwapPrequoteGate(
      "kyberswap.swap.sell",
      { ...EVM_PARAMS, tokenIn: NATIVE_TOKEN_ADDRESS },
      ctx(),
    );
    const hashFromSentinel = mockFindLatest.mock.calls[0]![1];
    expect(hashFromKeyword).toBe(hashFromSentinel);
    // And both equal the recorder-side hash for a native-sentinel leg.
    expect(hashFromKeyword).toBe(
      mod.computePrequoteMatchHash({
        kind: "swap",
        sessionId: SESSION_ID,
        family: "eip155",
        chainId: 8453,
        walletAddress: "0xWALLET",
        tokenIn: NATIVE_TOKEN_ADDRESS,
        tokenOut: GATE_TOKEN_OUT,
        amount: "1",
      }),
    );
  });

  it("R2: a non-native bare symbol leg → block(unresolved_token), no DB read, no network resolve", async () => {
    const d = await mod.evaluateSwapPrequoteGate(
      "kyberswap.swap.sell",
      { ...EVM_PARAMS, tokenIn: "USDC" },
      ctx(),
    );
    expect(d.kind).toBe("block");
    if (d.kind === "block") expect(d.reason).toBe("unresolved_token");
    expect(mockExistsFail).not.toHaveBeenCalled();
    expect(mockFindLatest).not.toHaveBeenCalled();
  });

  // ── Quote→execute hash collision ───────────────────────────────────────

  it("EVM: a recorded prequote and a matching execute collide (allow); a different amount misses", async () => {
    mockExistsFail.mockResolvedValue(false);
    mockFindLatest.mockResolvedValue(prequoteRow("pass"));
    const matchHash = mod.computePrequoteMatchHash({
      kind: "swap",
      sessionId: SESSION_ID,
      family: "eip155",
      chainId: 8453,
      walletAddress: "0xWALLET",
      tokenIn: GATE_TOKEN_IN,
      tokenOut: GATE_TOKEN_OUT,
      amount: "1",
    });
    await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(mockFindLatest.mock.calls[0]![1]).toBe(matchHash);
    // A different amount produces a different hash → would miss the recorded row.
    resetMocks();
    mockFindLatest.mockResolvedValue(null);
    await mod.evaluateSwapPrequoteGate(
      "kyberswap.swap.sell",
      { ...EVM_PARAMS, amountIn: "2" },
      ctx(),
    );
    expect(mockFindLatest.mock.calls[0]![1]).not.toBe(matchHash);
  });

  it("Solana: symbol legs resolve to mints via the jupiter resolver, then hash + allow", async () => {
    // input passed as a SYMBOL; resolver maps it to SOLANA_MINT_A (the recorded mint).
    mockRequireJupiter.mockImplementation(async (q: string) =>
      q === "SOLSYM" ? { address: SOLANA_MINT_A } : { address: q },
    );
    mockExistsFail.mockResolvedValue(false);
    mockFindLatest.mockResolvedValue(prequoteRow("pass", { family: "solana", chainId: null }));
    const d = await mod.evaluateSwapPrequoteGate(
      "solana.swap.execute",
      { inputToken: "SOLSYM", outputToken: SOL_MINT, amount: 1 },
      ctx(),
    );
    expect(d.kind).toBe("allow");
    // Hash must equal the recorder hash for the RESOLVED mint (not the symbol).
    const expected = mod.computePrequoteMatchHash({
      kind: "swap",
      sessionId: SESSION_ID,
      family: "solana",
      chainId: null,
      walletAddress: "0xWALLET",
      tokenIn: SOLANA_MINT_A,
      tokenOut: SOL_MINT,
      amount: "1",
    });
    expect(mockFindLatest.mock.calls[0]![1]).toBe(expected);
    expect(mockFindLatest.mock.calls[0]![2]).toBe("swap");
  });

  // ── R3 fail-closed ─────────────────────────────────────────────────────

  it("R3: a thrown DB read → block(gate_error), no raw text in message", async () => {
    mockExistsFail.mockRejectedValue(new Error("connection refused at 10.0.0.1:5432 secret=hunter2"));
    const d = await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(d.kind).toBe("block");
    if (d.kind === "block") {
      expect(d.reason).toBe("gate_error");
      expect(d.message).not.toContain("hunter2");
      expect(d.message).not.toContain("10.0.0.1");
      expect(d.message).toMatch(/could not verify a fresh quote/i);
    }
  });

  it("R3: a thrown Solana resolve → block(gate_error), no raw text", async () => {
    mockRequireJupiter.mockRejectedValue(new Error("jupiter 500 https://api.jup.ag/key=SECRET"));
    const d = await mod.evaluateSwapPrequoteGate("solana.swap.execute", SOL_PARAMS, ctx());
    expect(d.kind).toBe("block");
    if (d.kind === "block") {
      expect(d.reason).toBe("gate_error");
      expect(d.message).not.toContain("SECRET");
      expect(d.message).not.toContain("jup.ag");
    }
    // Fail-closed: a resolve throw must never reach a DB read or allow.
    expect(mockExistsFail).not.toHaveBeenCalled();
  });

  it("R3: a resolveSelectedAddress throw → block(gate_error), no fabricated address", async () => {
    mockResolveSelectedAddress.mockImplementation(() => {
      throw new VexError(ErrorCodes.WALLET_NOT_SELECTED, "no wallet selected");
    });
    const d = await mod.evaluateSwapPrequoteGate("kyberswap.swap.sell", EVM_PARAMS, ctx());
    expect(d.kind === "block" && d.reason).toBe("gate_error");
    expect(mockExistsFail).not.toHaveBeenCalled();
  });

  it("R3: missing sessionId → block(no_session), no execution", async () => {
    const d = await mod.evaluateSwapPrequoteGate(
      "kyberswap.swap.sell",
      EVM_PARAMS,
      ctx({ sessionId: undefined }),
    );
    expect(d.kind).toBe("block");
    if (d.kind === "block") expect(d.reason).toBe("no_session");
    expect(mockResolveSelectedAddress).not.toHaveBeenCalled();
    expect(mockExistsFail).not.toHaveBeenCalled();
  });

  it("an unsupported EVM chain → block(gate_error) (resolveChainSlug throws, caught fail-closed)", async () => {
    const d = await mod.evaluateSwapPrequoteGate(
      "kyberswap.swap.sell",
      { ...EVM_PARAMS, chain: "not-a-real-chain" },
      ctx(),
    );
    expect(d.kind === "block" && d.reason).toBe("gate_error");
  });
});
