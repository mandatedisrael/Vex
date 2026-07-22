import { describe, expect, it } from "vitest";
import {
  costBasisSchema,
  tokenHistoryCursorSchema,
  tokenHistoryDtoSchema,
  tokenHistoryEntrySchema,
  tokenHistoryReadInputSchema,
} from "../token-history.js";

const EVM_CHAIN_ID = 8453; // Base
const SOLANA_CHAIN_ID = 20011000000; // Khalani synthetic Solana chain id
const EVM_ADDR = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const EVM_ADDR_LOWER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOL_ADDR = "So11111111111111111111111111111111111111112";
const ISO = "2026-05-21T10:00:00.000Z";
const ISO_MICRO = "2026-05-21T10:00:00.123456Z";

describe("tokenHistoryReadInputSchema", () => {
  it("accepts an EVM chain + address, cursor null, and lower-cases the address", () => {
    const parsed = tokenHistoryReadInputSchema.safeParse({
      chainId: EVM_CHAIN_ID,
      tokenAddress: EVM_ADDR,
      cursor: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tokenAddress).toBe(EVM_ADDR_LOWER);
    }
  });

  it("rejects a Solana-shaped address on an EVM chain", () => {
    const parsed = tokenHistoryReadInputSchema.safeParse({
      chainId: EVM_CHAIN_ID,
      tokenAddress: SOL_ADDR,
      cursor: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a Solana chain + base58 address verbatim (no case-folding)", () => {
    const parsed = tokenHistoryReadInputSchema.safeParse({
      chainId: SOLANA_CHAIN_ID,
      tokenAddress: SOL_ADDR,
      cursor: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tokenAddress).toBe(SOL_ADDR);
    }
  });

  it("rejects an EVM-shaped address on the Solana chain", () => {
    const parsed = tokenHistoryReadInputSchema.safeParse({
      chainId: SOLANA_CHAIN_ID,
      tokenAddress: EVM_ADDR,
      cursor: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a request with no tokenAddress (address is required, no symbol-only lookup)", () => {
    const parsed = tokenHistoryReadInputSchema.safeParse({
      chainId: EVM_CHAIN_ID,
      cursor: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a stray extra key (.strict())", () => {
    const parsed = tokenHistoryReadInputSchema.safeParse({
      chainId: EVM_CHAIN_ID,
      tokenAddress: EVM_ADDR,
      cursor: null,
      symbol: "USDC",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a well-formed cursor", () => {
    const parsed = tokenHistoryReadInputSchema.safeParse({
      chainId: EVM_CHAIN_ID,
      tokenAddress: EVM_ADDR,
      cursor: { createdAt: ISO_MICRO, sourceRank: 1, sourceId: "42" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a cursor missing microsecond precision", () => {
    const parsed = tokenHistoryCursorSchema.safeParse({
      createdAt: ISO,
      sourceRank: 1,
      sourceId: "42",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a cursor with an out-of-range sourceRank", () => {
    const parsed = tokenHistoryCursorSchema.safeParse({
      createdAt: ISO_MICRO,
      sourceRank: 2,
      sourceId: "42",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("tokenHistoryEntrySchema", () => {
  const base = {
    id: "activity:1",
    createdAt: ISO,
    txRefs: [{ chainId: EVM_CHAIN_ID, ref: "0xdeadbeef" }],
  };

  const leg = {
    token: EVM_ADDR_LOWER,
    symbol: "USDC",
    localSymbol: null,
    amount: { value: "1.5", unitProvenance: "human" as const },
    valueUsd: "1.50",
  };

  it("round-trips a swap entry", () => {
    const parsed = tokenHistoryEntrySchema.safeParse({
      ...base,
      kind: "swap",
      chain: "base",
      venue: "kyberswap",
      tradeSide: "buy",
      productType: "spot",
      input: leg,
      output: leg,
      unitPriceUsd: "1.00",
      captureStatus: "executed",
    });
    expect(parsed.success).toBe(true);
  });

  it("round-trips a bridge entry with a distinct destination chain", () => {
    const parsed = tokenHistoryEntrySchema.safeParse({
      ...base,
      kind: "bridge",
      originChain: "8453",
      destinationChain: "42161",
      venue: "relay",
      input: leg,
      output: leg,
      captureStatus: "executed",
    });
    expect(parsed.success).toBe(true);
  });

  it("round-trips a transfer entry", () => {
    const parsed = tokenHistoryEntrySchema.safeParse({
      kind: "transfer",
      id: "intent-abc",
      createdAt: ISO,
      chain: "base",
      toAddress: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      amount: { value: "2.0", unitProvenance: "human" },
      token: EVM_ADDR_LOWER,
      status: "executed",
      txRefs: [{ chainId: EVM_CHAIN_ID, ref: "0xabc123" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an entry with an unknown kind (closed discriminated union)", () => {
    const parsed = tokenHistoryEntrySchema.safeParse({
      ...base,
      kind: "airdrop",
      chain: "base",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects more than 4 txRefs", () => {
    const parsed = tokenHistoryEntrySchema.safeParse({
      ...base,
      kind: "swap",
      chain: "base",
      venue: null,
      tradeSide: null,
      productType: null,
      input: leg,
      output: leg,
      unitPriceUsd: null,
      captureStatus: null,
      txRefs: [0, 1, 2, 3, 4].map((n) => ({ chainId: EVM_CHAIN_ID, ref: `0x${n}` })),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unbounded unitProvenance value (hostile fixture)", () => {
    const parsed = tokenHistoryEntrySchema.safeParse({
      ...base,
      kind: "swap",
      chain: "base",
      venue: null,
      tradeSide: null,
      productType: null,
      input: { ...leg, amount: { value: "1", unitProvenance: "confident" } },
      output: leg,
      unitPriceUsd: null,
      captureStatus: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a raw URL smuggled into a txRef (never a URL, only a ref)", () => {
    const parsed = tokenHistoryEntrySchema.safeParse({
      ...base,
      kind: "swap",
      chain: "base",
      venue: null,
      tradeSide: null,
      productType: null,
      input: leg,
      output: leg,
      unitPriceUsd: null,
      captureStatus: null,
      txRefs: [{ chainId: EVM_CHAIN_ID, ref: "" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("costBasisSchema", () => {
  it("round-trips a lots result", () => {
    const parsed = costBasisSchema.safeParse({
      kind: "lots",
      openLots: [
        {
          quantity: { value: "1000000000000000000", unitProvenance: "atomic" },
          priceUsd: "2500.00",
          costBasisUsd: "2500.00",
          openedAt: ISO,
        },
      ],
      totalOpenQuantity: "1000000000000000000",
      avgOpenPriceUsd: "2500.00",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the none variant with no other fields", () => {
    expect(costBasisSchema.safeParse({ kind: "none" }).success).toBe(true);
  });

  it("accepts the unavailable variant with no other fields", () => {
    expect(costBasisSchema.safeParse({ kind: "unavailable" }).success).toBe(true);
  });

  it("rejects openLots beyond the 50-lot display cap", () => {
    const lot = {
      quantity: { value: "1", unitProvenance: "atomic" as const },
      priceUsd: null,
      costBasisUsd: null,
      openedAt: ISO,
    };
    const parsed = costBasisSchema.safeParse({
      kind: "lots",
      openLots: Array.from({ length: 51 }, () => lot),
      totalOpenQuantity: "51",
      avgOpenPriceUsd: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown cost-basis kind", () => {
    expect(costBasisSchema.safeParse({ kind: "estimated" }).success).toBe(false);
  });
});

describe("tokenHistoryDtoSchema", () => {
  it("round-trips an available page with no entries and no open lots", () => {
    const parsed = tokenHistoryDtoSchema.safeParse({
      status: "available",
      entries: [],
      nextCursor: null,
      hasMore: false,
      costBasis: { kind: "none" },
    });
    expect(parsed.success).toBe(true);
  });

  it("round-trips the unavailable (timeout) shape", () => {
    const parsed = tokenHistoryDtoSchema.safeParse({
      status: "unavailable",
      reason: "query_timeout",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unavailable with a wrong reason literal (hostile fixture)", () => {
    const parsed = tokenHistoryDtoSchema.safeParse({
      status: "unavailable",
      reason: "connection_lost",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an available page mislabeled as never having rendered as no-history on timeout", () => {
    // A timeout must never be representable as an empty available page with
    // a reason attached — the two shapes are mutually exclusive by construction.
    const parsed = tokenHistoryDtoSchema.safeParse({
      status: "available",
      entries: [],
      nextCursor: null,
      hasMore: false,
      costBasis: { kind: "none" },
      reason: "query_timeout",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects more than 50 entries on one page", () => {
    const entry = {
      kind: "transfer" as const,
      id: "x",
      createdAt: ISO,
      chain: null,
      toAddress: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      amount: { value: "1", unitProvenance: "human" as const },
      token: null,
      status: "executed",
      txRefs: [],
    };
    const parsed = tokenHistoryDtoSchema.safeParse({
      status: "available",
      entries: Array.from({ length: 51 }, () => entry),
      nextCursor: null,
      hasMore: true,
      costBasis: { kind: "none" },
    });
    expect(parsed.success).toBe(false);
  });
});
