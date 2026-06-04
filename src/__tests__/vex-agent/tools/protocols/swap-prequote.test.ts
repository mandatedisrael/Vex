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
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { createHash } from "node:crypto";

import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";
import { VexError, ErrorCodes } from "../../../../errors.js";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

// ── Mocks ─────────────────────────────────────────────────────────────────

type CreateMock = Mock<(input: unknown) => Promise<void>>;
type ResolveMock = Mock<(...args: unknown[]) => string>;

let mockCreate: CreateMock;
let mockResolveSelectedAddress: ResolveMock;

function resetMocks() {
  mockCreate = vi.fn<(input: unknown) => Promise<void>>().mockResolvedValue(undefined);
  mockResolveSelectedAddress = vi
    .fn<(...args: unknown[]) => string>()
    .mockReturnValue("0xWALLET");
}
resetMocks();

vi.mock("@vex-agent/db/repos/swap-prequotes.js", () => ({
  create: (input: unknown) => mockCreate(input),
}));

vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: (...args: unknown[]) => mockResolveSelectedAddress(...args),
}));

const mod = await import("@vex-agent/tools/protocols/swap-prequote.js");

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
