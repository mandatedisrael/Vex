/**
 * Bridge prequote — Stage 8c unit tests.
 *
 * Pins (Codex 8c requirements #3/#4 + identical quote↔execute identity):
 *   - Discriminated match-hash: a swap and a bridge with otherwise-similar
 *     values NEVER collide; bridge determinism; per-field sensitivity for every
 *     bridge field (fromChainId/toChainId/fromToken/toToken/amount/recipient/
 *     tradeType/sourceWallet); recipient + tradeType defaults applied identically.
 *   - Bridge recording: a khalani.quote.get success records ONE kind='bridge'
 *     row with verdict='unknown' + the shared bridge identity; malformed →
 *     no row (no throw); wallet-unresolved → skip.
 *   - Bridge gate: no bridge quote → block before approval; fresh bridge
 *     prequote → allow; a thrown identity build / DB read → fail-closed block;
 *     gate reads kind='bridge'.
 *   - Identity collision: a recorded bridge_quote then a matching khalani.bridge
 *     execute → SAME match-hash (allow); a different chain/token/amount/recipient/
 *     tradeType → different hash (block).
 *   - Money/fee binding (8c security fix): refundTo/referrer/referrerFeeBps/filler
 *     are bound into the identity. EXPLOIT GUARD — a quote without refundTo does
 *     NOT authorize an execute that changes refundTo (or referrer/feeBps/filler):
 *     hash misses → block(no_quote). Matching money/fee params (both omit →
 *     defaults, or both explicit, incl. numeric "0100"≡"100") collide → allow.
 *     Per-field canonicalization: refundTo source-family, referrer EVM-lowercase,
 *     filler case-PRESERVED (opaque provider name), referrerFeeBps numeric.
 *   - Unbindable execute-only params: a non-empty routeId/depositMethod on the
 *     bridge EXECUTE → block(unbindable_param) BEFORE any prequote lookup
 *     (fail-closed; protects the direct execute_tool path too).
 *
 * `getCachedKhalaniChains` / `resolveChainId` / `getChainFamily` are mocked so
 * the chain registry is deterministic and offline; the alias for both the QUOTE
 * (khalani.quote.get) and the EXECUTE (khalani.bridge) is identical, proving the
 * shared `buildBridgeIdentity` makes their hashes collide.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

import { VexError, ErrorCodes } from "../../../../errors.js";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";
import type { SwapPrequote, SafetyVerdict } from "@vex-agent/db/repos/swap-prequotes.js";

// ── Mocks ─────────────────────────────────────────────────────────────────

type CreateMock = Mock<(input: unknown) => Promise<void>>;
type ResolveMock = Mock<(...args: unknown[]) => string>;
type FindMock = Mock<(s: string, h: string, k: string) => Promise<SwapPrequote | null>>;
type ExistsMock = Mock<(s: string, h: string, k: string) => Promise<boolean>>;

let mockCreate: CreateMock;
let mockResolveSelectedAddress: ResolveMock;
let mockFindLatest: FindMock;
let mockExistsFail: ExistsMock;

// Deterministic Khalani chain registry. EVM chain 8453 (base) → eip155; chain
// 20011000000 (solana) → solana. resolveChainId maps the known aliases/ids.
const CHAIN_FAMILY: Record<number, "eip155" | "solana"> = {
  1: "eip155",
  8453: "eip155",
  20011000000: "solana",
};
const CHAIN_ALIAS: Record<string, number> = {
  ethereum: 1,
  eth: 1,
  base: 8453,
  "8453": 8453,
  solana: 20011000000,
  sol: 20011000000,
};

function resolveChainIdMock(input: string): number {
  const norm = input.trim().toLowerCase();
  const aliased = CHAIN_ALIAS[norm];
  if (aliased !== undefined) return aliased;
  const numeric = Number(norm);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  throw new VexError(ErrorCodes.KHALANI_UNSUPPORTED_CHAIN, `Unsupported chain: ${input}`);
}

function getChainFamilyMock(chainId: number): "eip155" | "solana" {
  const fam = CHAIN_FAMILY[chainId];
  if (!fam) throw new VexError(ErrorCodes.KHALANI_UNSUPPORTED_CHAIN, `Chain ${chainId} unknown.`);
  return fam;
}

function resetMocks() {
  mockCreate = vi.fn<(input: unknown) => Promise<void>>().mockResolvedValue(undefined);
  // Family-aware wallet stub: EVM wallet vs Solana wallet differ so a
  // source-vs-dest family mistake would be visible in the identity.
  mockResolveSelectedAddress = vi
    .fn<(...args: unknown[]) => string>()
    .mockImplementation((_r: unknown, _p: unknown, family: unknown) =>
      family === "solana" ? "SoLDestWa11et" : "0xEVMWALLET",
    );
  mockFindLatest = vi
    .fn<(s: string, h: string, k: string) => Promise<SwapPrequote | null>>()
    .mockResolvedValue(null);
  mockExistsFail = vi
    .fn<(s: string, h: string, k: string) => Promise<boolean>>()
    .mockResolvedValue(false);
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

vi.mock("@tools/khalani/chains.js", () => ({
  getCachedKhalaniChains: async () => [],
  resolveChainId: (input: string) => resolveChainIdMock(input),
  getChainFamily: (chainId: number) => getChainFamilyMock(chainId),
}));

const mod = await import("@vex-agent/tools/protocols/swap-prequote.js");

beforeEach(() => {
  resetMocks();
});

// ── Fixtures ────────────────────────────────────────────────────────────

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const EVM_TOKEN = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // source token (EVM)
const SOL_MINT_TOKEN = "DestMintCaseSensitiveABC123"; // dest token (Solana)

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

/** Alias-translated bridge params shared by quote (khalani.quote.get) + execute. */
function bridgeParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fromChain: "base",
    fromToken: EVM_TOKEN,
    toChain: "solana",
    toToken: SOL_MINT_TOKEN,
    amount: "1000000",
    ...overrides,
  };
}

/** A bridge prequote row stub (gate reads only a few fields). */
function bridgeRow(verdict: SafetyVerdict, overrides: Partial<SwapPrequote> = {}): SwapPrequote {
  return {
    prequoteId: "prequote-bridge-1",
    sessionId: SESSION_ID,
    matchHash: "h".repeat(64),
    kind: "bridge",
    family: "eip155",
    provider: "khalani",
    chainId: 8453,
    walletAddress: "0xEVMWALLET",
    tokenIn: EVM_TOKEN,
    tokenOut: SOL_MINT_TOKEN,
    amount: "1000000",
    slippageBps: null,
    safetyVerdict: verdict,
    safetyDetail: { bridge: true, note: "route-only; no token-safety check" },
    routeRef: null,
    createdAt: "2026-06-04T10:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Discriminated match-hash ─────────────────────────────────────────────

describe("computePrequoteMatchHash — bridge identity", () => {
  const bridgeBase = {
    kind: "bridge" as const,
    sessionId: SESSION_ID,
    sourceFamily: "eip155" as const,
    destFamily: "solana" as const,
    fromChainId: 8453,
    toChainId: 20011000000,
    sourceWallet: "0xEVMWALLET",
    recipient: "SoLDestWa11et",
    fromToken: EVM_TOKEN,
    toToken: SOL_MINT_TOKEN,
    amount: "1000000",
    tradeType: "EXACT_INPUT" as const,
    // Money/fee leg (8c) — defaulted: refundTo == sourceWallet, the rest "".
    refundTo: "0xEVMWALLET",
    referrer: "",
    referrerFeeBps: "",
    filler: "",
  };

  it("is deterministic and a full sha256 hex digest", () => {
    const h = mod.computePrequoteMatchHash(bridgeBase);
    expect(h).toBe(mod.computePrequoteMatchHash({ ...bridgeBase }));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a swap and a bridge with otherwise-similar values NEVER collide", () => {
    // Construct a swap identity that reuses overlapping values; the leading kind
    // tag + different field set must yield a different digest.
    const swapHash = mod.computePrequoteMatchHash({
      kind: "swap",
      sessionId: SESSION_ID,
      family: "eip155",
      chainId: 8453,
      walletAddress: "0xEVMWALLET",
      tokenIn: EVM_TOKEN,
      tokenOut: SOL_MINT_TOKEN,
      amount: "1000000",
    });
    expect(mod.computePrequoteMatchHash(bridgeBase)).not.toBe(swapHash);
  });

  it("EVM source leg lowercases; Solana dest leg preserves case", () => {
    const lowerSource = mod.computePrequoteMatchHash({
      ...bridgeBase,
      sourceWallet: "0xEVMWALLET".toUpperCase(),
      fromToken: EVM_TOKEN.toUpperCase(),
    });
    // EVM source fields are case-insensitive → same hash.
    expect(lowerSource).toBe(mod.computePrequoteMatchHash(bridgeBase));
    // Solana dest token IS case-sensitive → different hash.
    const lowerDest = mod.computePrequoteMatchHash({
      ...bridgeBase,
      toToken: SOL_MINT_TOKEN.toLowerCase(),
    });
    expect(lowerDest).not.toBe(mod.computePrequoteMatchHash(bridgeBase));
  });

  it("each bridge field changes the hash", () => {
    const h = mod.computePrequoteMatchHash(bridgeBase);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, fromChainId: 1 })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, toChainId: 1 })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, fromToken: "0xCAFE" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, toToken: "OtherMint" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, amount: "2000000" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, recipient: "OtherRecip" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, tradeType: "EXACT_OUTPUT" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, sourceWallet: "0xOTHER" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, sessionId: "other" })).not.toBe(h);
  });

  it("each money/fee field changes the hash (8c binding)", () => {
    const h = mod.computePrequoteMatchHash(bridgeBase);
    // refundTo differs from the defaulted sourceWallet → distinct identity.
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, refundTo: "0xATTACKER" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, referrer: "0xReFeRrEr" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, referrerFeeBps: "100" })).not.toBe(h);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, filler: "native-filler" })).not.toBe(h);
  });

  it("money/fee canonicalization: refundTo EVM case-insensitive, referrer lowercase, filler case-PRESERVED", () => {
    const h = mod.computePrequoteMatchHash(bridgeBase);
    // refundTo is a SOURCE (EVM) address → case-insensitive.
    expect(
      mod.computePrequoteMatchHash({ ...bridgeBase, refundTo: "0xEVMWALLET".toUpperCase() }),
    ).toBe(h);
    // referrer is an EVM address → lowercased: two casings collide.
    const ref = mod.computePrequoteMatchHash({ ...bridgeBase, referrer: "0xABCDEF0000000000000000000000000000000000" });
    expect(
      mod.computePrequoteMatchHash({ ...bridgeBase, referrer: "0xabcdef0000000000000000000000000000000000" }),
    ).toBe(ref);
    // filler is an OPAQUE provider name → case-SENSITIVE (NOT an address).
    const filler = mod.computePrequoteMatchHash({ ...bridgeBase, filler: "Native-Filler" });
    expect(
      mod.computePrequoteMatchHash({ ...bridgeBase, filler: "native-filler" }),
    ).not.toBe(filler);
  });

  it("the hash treats referrerFeeBps as the ALREADY-canonical string (builder owns canonicalization)", () => {
    // The pure hash does NOT re-canonicalize — `BridgeMatchInput.referrerFeeBps`
    // is the canonical integer string the builder produced. Distinct canonical
    // strings → distinct hashes; "" (omitted) is its own stable token.
    const h100 = mod.computePrequoteMatchHash({ ...bridgeBase, referrerFeeBps: "100" });
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, referrerFeeBps: "200" })).not.toBe(h100);
    expect(mod.computePrequoteMatchHash({ ...bridgeBase, referrerFeeBps: "0" })).not.toBe(
      mod.computePrequoteMatchHash({ ...bridgeBase, referrerFeeBps: "" }),
    );
  });
});

// ── buildBridgeIdentity — shared builder defaults ────────────────────────

describe("buildBridgeIdentity — defaults", () => {
  it("derives families + chain ids and defaults recipient to the dest-family wallet", async () => {
    const id = await mod.buildBridgeIdentity(SESSION_ID, bridgeParams(), ctx());
    expect(id.kind).toBe("bridge");
    expect(id.sourceFamily).toBe("eip155");
    expect(id.destFamily).toBe("solana");
    expect(id.fromChainId).toBe(8453);
    expect(id.toChainId).toBe(20011000000);
    expect(id.sourceWallet).toBe("0xEVMWALLET"); // EVM source wallet
    expect(id.recipient).toBe("SoLDestWa11et"); // defaulted to dest-family wallet
    expect(id.tradeType).toBe("EXACT_INPUT"); // default
  });

  it("an explicit recipient is honored (not defaulted)", async () => {
    const id = await mod.buildBridgeIdentity(
      SESSION_ID,
      bridgeParams({ recipient: "ExplicitRecipient" }),
      ctx(),
    );
    expect(id.recipient).toBe("ExplicitRecipient");
  });

  it("tradeType EXACT_OUTPUT is preserved; anything else defaults to EXACT_INPUT", async () => {
    const out = await mod.buildBridgeIdentity(SESSION_ID, bridgeParams({ tradeType: "EXACT_OUTPUT" }), ctx());
    expect(out.tradeType).toBe("EXACT_OUTPUT");
    const garbage = await mod.buildBridgeIdentity(SESSION_ID, bridgeParams({ tradeType: "WAT" }), ctx());
    expect(garbage.tradeType).toBe("EXACT_INPUT");
  });

  it("throws on a missing required field", async () => {
    await expect(
      mod.buildBridgeIdentity(SESSION_ID, bridgeParams({ amount: "" }), ctx()),
    ).rejects.toBeInstanceOf(VexError);
  });

  it("throws on an unresolved chain", async () => {
    await expect(
      mod.buildBridgeIdentity(SESSION_ID, bridgeParams({ fromChain: "not-a-chain" }), ctx()),
    ).rejects.toBeInstanceOf(VexError);
  });

  it("defaults the money/fee leg (refundTo=sourceWallet, referrer/referrerFeeBps/filler empty)", async () => {
    const id = await mod.buildBridgeIdentity(SESSION_ID, bridgeParams(), ctx());
    // refundTo mirrors prepareQuoteRequest: omitted → the resolved fromAddress,
    // which under a session IS the source wallet.
    expect(id.refundTo).toBe("0xEVMWALLET");
    expect(id.referrer).toBe("");
    expect(id.referrerFeeBps).toBe("");
    expect(id.filler).toBe("");
  });

  it("honors explicit money/fee params (and canonicalizes referrerFeeBps)", async () => {
    const id = await mod.buildBridgeIdentity(
      SESSION_ID,
      bridgeParams({
        refundTo: "0xRefundElsewhere",
        referrer: "0xReferrer",
        referrerFeeBps: "0100", // leading zero → canonical "100"
        filler: "native-filler",
      }),
      ctx(),
    );
    expect(id.refundTo).toBe("0xRefundElsewhere");
    expect(id.referrer).toBe("0xReferrer");
    expect(id.referrerFeeBps).toBe("100");
    expect(id.filler).toBe("native-filler");
  });

  it("throws on an out-of-range / non-integer referrerFeeBps (fail-closed parity with the handler)", async () => {
    await expect(
      mod.buildBridgeIdentity(SESSION_ID, bridgeParams({ referrerFeeBps: "10000" }), ctx()),
    ).rejects.toBeInstanceOf(VexError);
    await expect(
      mod.buildBridgeIdentity(SESSION_ID, bridgeParams({ referrerFeeBps: "1.5" }), ctx()),
    ).rejects.toBeInstanceOf(VexError);
  });
});

// ── Recording (khalani.quote.get → kind='bridge', verdict='unknown') ─────

describe("recordPrequoteFromQuote — bridge", () => {
  it("records ONE kind='bridge' row with verdict='unknown' + the bridge identity", async () => {
    await mod.recordPrequoteFromQuote(
      "khalani.quote.get",
      bridgeParams(),
      { quoteId: "q1", routes: [{ routeId: "r1" }] },
      ctx(),
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const input = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.kind).toBe("bridge");
    expect(input.provider).toBe("khalani");
    expect(input.family).toBe("eip155"); // source family
    expect(input.chainId).toBe(8453); // source chain id
    expect(input.walletAddress).toBe("0xEVMWALLET");
    expect(input.tokenIn).toBe(EVM_TOKEN);
    expect(input.tokenOut).toBe(SOL_MINT_TOKEN);
    expect(input.amount).toBe("1000000");
    expect(input.slippageBps).toBeNull();
    expect(input.safetyVerdict).toBe("unknown");
    expect(input.safetyDetail).toEqual({ bridge: true, note: "route-only; no token-safety check" });
    // match_hash equals the pure function on the shared identity.
    const id = await mod.buildBridgeIdentity(SESSION_ID, bridgeParams(), ctx());
    expect(input.matchHash).toBe(mod.computePrequoteMatchHash(id));
  });

  it("records nothing for a malformed (chain-unresolvable) quote (no throw)", async () => {
    await expect(
      mod.recordPrequoteFromQuote(
        "khalani.quote.get",
        bridgeParams({ toChain: "not-a-chain" }),
        { quoteId: "q1" },
        ctx(),
      ),
    ).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("records nothing when the source wallet is unresolved (no throw, no fabricated row)", async () => {
    mockResolveSelectedAddress.mockImplementation(() => {
      throw new VexError(ErrorCodes.WALLET_NOT_SELECTED, "no wallet");
    });
    await expect(
      mod.recordPrequoteFromQuote("khalani.quote.get", bridgeParams(), { quoteId: "q1" }, ctx()),
    ).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("records nothing when sessionId is absent", async () => {
    await mod.recordPrequoteFromQuote(
      "khalani.quote.get",
      bridgeParams(),
      { quoteId: "q1" },
      ctx({ sessionId: undefined }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("swallows a DB write failure (never throws to the caller)", async () => {
    mockCreate.mockRejectedValueOnce(new Error("boom"));
    await expect(
      mod.recordPrequoteFromQuote("khalani.quote.get", bridgeParams(), { quoteId: "q1" }, ctx()),
    ).resolves.toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ── Gate (khalani.bridge → kind='bridge') ────────────────────────────────

describe("evaluatePrequoteGate — bridge", () => {
  it("no fresh bridge prequote → block(no_quote), bridge-worded, reads kind='bridge'", async () => {
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(), ctx());
    expect(d.kind).toBe("block");
    if (d.kind === "block") {
      expect(d.reason).toBe("no_quote");
      expect(d.message).toMatch(/bridge_quote/i);
    }
    expect(mockExistsFail.mock.calls[0]![2]).toBe("bridge");
    expect(mockFindLatest.mock.calls[0]![2]).toBe("bridge");
  });

  it("a fresh bridge prequote (unknown) → allow(unknown)", async () => {
    mockFindLatest.mockResolvedValue(bridgeRow("unknown"));
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(), ctx());
    expect(d.kind).toBe("allow");
    if (d.kind === "allow") {
      expect(d.verdict).toBe("unknown");
      expect(d.prequoteId).toBe("prequote-bridge-1");
    }
  });

  it("a fresh fail row blocks (uniformity — existsFreshFail dominates)", async () => {
    mockExistsFail.mockResolvedValue(true);
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(), ctx());
    expect(d.kind === "block" && d.reason).toBe("safety_fail");
    expect(mockFindLatest).not.toHaveBeenCalled();
  });

  it("fail-closed on a thrown identity build (unresolved chain) → block(gate_error)", async () => {
    const d = await mod.evaluatePrequoteGate(
      "khalani.bridge",
      bridgeParams({ fromChain: "not-a-chain" }),
      ctx(),
    );
    expect(d.kind === "block" && d.reason).toBe("gate_error");
    expect(mockExistsFail).not.toHaveBeenCalled();
  });

  it("fail-closed on a thrown DB read, no raw text in message", async () => {
    mockExistsFail.mockRejectedValue(new Error("connection refused 10.0.0.1 secret=hunter2"));
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(), ctx());
    expect(d.kind).toBe("block");
    if (d.kind === "block") {
      expect(d.reason).toBe("gate_error");
      expect(d.message).not.toContain("hunter2");
      expect(d.message).not.toContain("10.0.0.1");
    }
  });

  it("fail-closed on a wallet-resolve throw → block(gate_error), no fabricated address", async () => {
    mockResolveSelectedAddress.mockImplementation(() => {
      throw new VexError(ErrorCodes.WALLET_NOT_SELECTED, "no wallet");
    });
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(), ctx());
    expect(d.kind === "block" && d.reason).toBe("gate_error");
    expect(mockExistsFail).not.toHaveBeenCalled();
  });

  it("missing sessionId → block(no_session)", async () => {
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(), ctx({ sessionId: undefined }));
    expect(d.kind === "block" && d.reason).toBe("no_session");
    expect(mockResolveSelectedAddress).not.toHaveBeenCalled();
  });
});

// ── Fail-closed on EXECUTE-ONLY routeId / depositMethod (8c) ──────────────

describe("evaluatePrequoteGate — bridge unbindable execute-only params", () => {
  it("a non-empty routeId → block(unbindable_param) BEFORE any prequote lookup", async () => {
    // Even with a fresh matching prequote present, an unbindable param must block.
    mockFindLatest.mockResolvedValue(bridgeRow("unknown"));
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams({ routeId: "r1" }), ctx());
    expect(d.kind).toBe("block");
    if (d.kind === "block") {
      expect(d.reason).toBe("unbindable_param");
      expect(d.message).toMatch(/routeId\/depositMethod/);
    }
    // Fail-closed before touching the prequote store.
    expect(mockExistsFail).not.toHaveBeenCalled();
    expect(mockFindLatest).not.toHaveBeenCalled();
  });

  it("a non-empty depositMethod → block(unbindable_param)", async () => {
    mockFindLatest.mockResolvedValue(bridgeRow("unknown"));
    const d = await mod.evaluatePrequoteGate(
      "khalani.bridge",
      bridgeParams({ depositMethod: "PERMIT2" }),
      ctx(),
    );
    expect(d.kind === "block" && d.reason).toBe("unbindable_param");
    expect(mockExistsFail).not.toHaveBeenCalled();
  });

  it("an empty-string routeId/depositMethod is treated as absent (still allows on a fresh quote)", async () => {
    mockFindLatest.mockResolvedValue(bridgeRow("unknown"));
    const d = await mod.evaluatePrequoteGate(
      "khalani.bridge",
      bridgeParams({ routeId: "", depositMethod: "" }),
      ctx(),
    );
    expect(d.kind).toBe("allow");
  });
});

// ── Identity collision: recorded bridge_quote ↔ matching khalani.bridge ───

describe("bridge quote ↔ execute identity collision", () => {
  it("a recorded bridge_quote and a matching khalani.bridge execute collide (allow)", async () => {
    // 1) Record from the QUOTE params.
    await mod.recordPrequoteFromQuote("khalani.quote.get", bridgeParams(), { quoteId: "q1" }, ctx());
    const recorded = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    const recordedHash = recorded.matchHash as string;

    // 2) The gate, given the IDENTICAL execute params, computes the same hash.
    resetMocks();
    let gateHash = "";
    mockFindLatest.mockImplementation(async (_s, h) => {
      gateHash = h;
      return bridgeRow("unknown", { matchHash: h });
    });
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(), ctx());
    expect(d.kind).toBe("allow");
    expect(gateHash).toBe(recordedHash);
  });

  it("a different fromChain/toChain/token/amount/recipient/tradeType MISSES the recorded row", async () => {
    await mod.recordPrequoteFromQuote("khalani.quote.get", bridgeParams(), { quoteId: "q1" }, ctx());
    const recordedHash = (mockCreate.mock.calls[0]![0] as Record<string, unknown>).matchHash as string;

    const variants: Array<Record<string, unknown>> = [
      { toChain: "ethereum", toToken: EVM_TOKEN }, // dest now EVM (different chain + family)
      { fromChain: "ethereum" },
      { fromToken: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
      { toToken: "DifferentMintXYZ" },
      { amount: "2000000" },
      { recipient: "ADifferentRecipient" },
      { tradeType: "EXACT_OUTPUT" },
    ];
    for (const v of variants) {
      resetMocks();
      let gateHash = "";
      mockFindLatest.mockImplementation(async (_s, h) => {
        gateHash = h;
        return null;
      });
      await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(v), ctx());
      expect(gateHash, `variant ${JSON.stringify(v)} should not collide`).not.toBe(recordedHash);
    }
  });

  it("EXPLOIT GUARD: a quote without refundTo does NOT authorize an execute with a changed refundTo", async () => {
    // Quote omits refundTo (→ defaults to sourceWallet). Execute supplies a
    // DIFFERENT refundTo (attacker address). The gate hash must NOT collide →
    // no matching prequote → block.
    await mod.recordPrequoteFromQuote("khalani.quote.get", bridgeParams(), { quoteId: "q1" }, ctx());
    const recordedHash = (mockCreate.mock.calls[0]![0] as Record<string, unknown>).matchHash as string;

    const tampered: Array<Record<string, unknown>> = [
      { refundTo: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, // refund to attacker
      { referrer: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" },
      { referrerFeeBps: "9999" },
      { filler: "evil-filler" },
    ];
    for (const v of tampered) {
      resetMocks();
      let gateHash = "";
      mockFindLatest.mockImplementation(async (_s, h) => {
        gateHash = h;
        return null;
      });
      const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(v), ctx());
      expect(gateHash, `tampered ${JSON.stringify(v)} must not collide`).not.toBe(recordedHash);
      expect(d.kind === "block" && d.reason, `tampered ${JSON.stringify(v)} must block`).toBe("no_quote");
    }
  });

  it("identical money/fee params (both omit → defaults) COLLIDE → allow", async () => {
    // Both quote and execute omit the whole money/fee leg → identical defaults →
    // identical hash → allow. (Already implied by the base collision test, but
    // pinned explicitly as the positive counterpart to the exploit guard.)
    await mod.recordPrequoteFromQuote("khalani.quote.get", bridgeParams(), { quoteId: "q1" }, ctx());
    const recordedHash = (mockCreate.mock.calls[0]![0] as Record<string, unknown>).matchHash as string;

    resetMocks();
    let gateHash = "";
    mockFindLatest.mockImplementation(async (_s, h) => {
      gateHash = h;
      return bridgeRow("unknown", { matchHash: h });
    });
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(), ctx());
    expect(d.kind).toBe("allow");
    expect(gateHash).toBe(recordedHash);
  });

  it("identical EXPLICIT money/fee params COLLIDE → allow (quote and execute agree)", async () => {
    const money = {
      refundTo: "0xRefundElsewhere",
      referrer: "0xReferrerAddr",
      referrerFeeBps: "100",
      filler: "native-filler",
    };
    await mod.recordPrequoteFromQuote("khalani.quote.get", bridgeParams(money), { quoteId: "q1" }, ctx());
    const recordedHash = (mockCreate.mock.calls[0]![0] as Record<string, unknown>).matchHash as string;

    resetMocks();
    let gateHash = "";
    mockFindLatest.mockImplementation(async (_s, h) => {
      gateHash = h;
      return bridgeRow("unknown", { matchHash: h });
    });
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams(money), ctx());
    expect(d.kind).toBe("allow");
    expect(gateHash).toBe(recordedHash);
  });

  it("referrerFeeBps numeric equivalence end-to-end: quote \"100\" ↔ execute \"0100\" COLLIDE (builder canonicalizes)", async () => {
    // The shared builder canonicalizes "0100" → "100" on BOTH sides, so a fee
    // expressed with a leading zero on execute still matches the quote.
    await mod.recordPrequoteFromQuote(
      "khalani.quote.get",
      bridgeParams({ referrerFeeBps: "100" }),
      { quoteId: "q1" },
      ctx(),
    );
    const recordedHash = (mockCreate.mock.calls[0]![0] as Record<string, unknown>).matchHash as string;

    resetMocks();
    let gateHash = "";
    mockFindLatest.mockImplementation(async (_s, h) => {
      gateHash = h;
      return bridgeRow("unknown", { matchHash: h });
    });
    const d = await mod.evaluatePrequoteGate("khalani.bridge", bridgeParams({ referrerFeeBps: "0100" }), ctx());
    expect(d.kind).toBe("allow");
    expect(gateHash).toBe(recordedHash);
  });
});
