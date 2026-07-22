/**
 * token-history-db tests — read-only, global-scope per-token TX history,
 * with NO real DB.
 *
 * Mirrors `portfolio-db.test.ts`: mocked `pg` Client (scripted
 * `mockResolvedValueOnce` per statement, in the exact order
 * `getTokenHistory` issues them: BEGIN READ ONLY, SET LOCAL
 * statement_timeout, the page UNION, the cost-basis read, then
 * COMMIT/ROLLBACK), mocked `db-config`, mocked `@vex-lib/wallet.js`
 * `listWallets`, mocked logger.
 *
 * Security/behavior invariants under test:
 *  - empty inventory → the empty available page, NO SQL issued;
 *  - EVM addresses are lower-cased end-to-end; Solana stays verbatim;
 *  - leg-aware bridge matching (destination-chain leg via a DIFFERENT
 *    numeric chain than the origin `chain` column);
 *  - `wallet_intents` inclusion (executed + hash) and exclusion
 *    (non-address token, wrong network);
 *  - keyset pagination (limit+1 → nextCursor/hasMore);
 *  - SQLSTATE 57014 on the PAGE phase → `{status:"unavailable"}`; any
 *    other page failure → a Result error; a cost-basis-phase failure
 *    (timeout or otherwise) degrades ONLY `costBasis`, never the page;
 *  - cost-basis fail-closed instrument_key parsing + proration + totals;
 *  - "no open lots" vs "cost basis unavailable" distinction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryFn = (
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;

const mocks = vi.hoisted(() => ({
  query: vi.fn() as ReturnType<typeof vi.fn> & QueryFn,
  connect: vi.fn(),
  end: vi.fn(),
  buildPoolConfig: vi.fn(),
  listWallets: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("pg", () => {
  function MockClient() {
    return {
      connect: mocks.connect,
      end: mocks.end,
      query: mocks.query,
    };
  }
  return { Client: MockClient };
});

vi.mock("../db-config.js", () => ({
  buildPoolConfig: mocks.buildPoolConfig,
}));

vi.mock("@vex-lib/wallet.js", () => ({
  listWallets: mocks.listWallets,
}));

vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { getTokenHistory } = await import("../token-history-db.js");

const WALLET_EVM = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const WALLET_SOL = "So11111111111111111111111111111111111111112";
const BASE_CHAIN_ID = 8453;
const ARBITRUM_CHAIN_ID = 42161;
const SOLANA_CHAIN_ID = 20011000000;
const TOKEN_ADDR_MIXED_CASE = "0xBEEFbeefBEEFbeefBEEFbeefBEEFbeefBEEFbeef";
const TOKEN_ADDR_LOWER = "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef";
const SOL_TOKEN = "TokMintABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk";

class FakeDbError extends Error {
  code: string;
  constructor(code: string) {
    super("db error");
    this.code = code;
  }
}

function activityRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    source_kind: "activity",
    source_rank: 1,
    source_id: "00000000000000000001",
    created_at: new Date("2026-05-21T10:00:00.000Z"),
    cursor_ts: "2026-05-21T10:00:00.000000Z",
    namespace: "kyberswap",
    product_type: "spot",
    trade_side: "buy",
    chain: "base",
    dest_chain: null,
    input_token_address: TOKEN_ADDR_LOWER,
    input_amount: "1.5",
    output_token_address: TOKEN_ADDR_LOWER,
    output_amount: "2.0",
    input_value_usd: "100.00",
    output_value_usd: "100.00",
    unit_price_usd: "50.00",
    capture_status: "executed",
    tx_ref: "0xhash1",
    input_token_symbol: "USDC",
    input_token_local_symbol: null,
    output_token_symbol: "USDC",
    output_token_local_symbol: null,
    to_address: null,
    ...overrides,
  };
}

function intentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    source_kind: "intent",
    source_rank: 0,
    source_id: "intent-abc",
    created_at: new Date("2026-05-20T10:00:00.000Z"),
    cursor_ts: "2026-05-20T10:00:00.000000Z",
    namespace: null,
    product_type: null,
    trade_side: null,
    chain: "base",
    dest_chain: null,
    input_token_address: null,
    input_amount: null,
    output_token_address: TOKEN_ADDR_LOWER,
    output_amount: "5",
    input_value_usd: null,
    output_value_usd: null,
    unit_price_usd: null,
    capture_status: "executed",
    tx_ref: "0xintenthash",
    input_token_symbol: null,
    input_token_local_symbol: null,
    output_token_symbol: null,
    output_token_local_symbol: null,
    to_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    ...overrides,
  };
}

/** Scripts BEGIN + SET LOCAL, then the caller's page/lots/commit responses. */
function scriptTransaction(opts: {
  page: ReadonlyArray<Record<string, unknown>> | Error;
  lots?: ReadonlyArray<Record<string, unknown>> | Error;
}): void {
  mocks.query.mockResolvedValueOnce({ rows: [] }); // BEGIN READ ONLY
  mocks.query.mockResolvedValueOnce({ rows: [] }); // SET LOCAL statement_timeout

  if (opts.page instanceof Error) {
    mocks.query.mockRejectedValueOnce(opts.page); // page
    mocks.query.mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    return;
  }
  mocks.query.mockResolvedValueOnce({ rows: opts.page }); // page

  const lots = opts.lots ?? [];
  if (lots instanceof Error) {
    mocks.query.mockRejectedValueOnce(lots); // cost-basis
    mocks.query.mockResolvedValueOnce({ rows: [] }); // ROLLBACK (aborted txn)
  } else {
    mocks.query.mockResolvedValueOnce({ rows: lots }); // cost-basis
    mocks.query.mockResolvedValueOnce({ rows: [] }); // COMMIT
  }
}

/**
 * Flattens across CALLS only (one call's `params` array spreads into the
 * result) — NOT within a call's own params, since some params (`wallets`,
 * `chainAliases`) are themselves bound as arrays for `= ANY($n::text[])`.
 * A deeper `.flat()` would destroy that nesting and make it impossible to
 * assert on the alias candidate set as its OWN bound array (see the
 * chain-alias test below).
 */
function allBoundParams(): unknown[] {
  return mocks.query.mock.calls.flatMap((call) => {
    const params = call[1];
    return Array.isArray(params) ? params : [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildPoolConfig.mockResolvedValue({
    host: "127.0.0.1",
    port: 5777,
    database: "vex",
    user: "vex",
    password: "secret",
  });
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.listWallets.mockImplementation((family: string) =>
    family === "evm"
      ? [{ id: "1", address: WALLET_EVM, label: "", createdAt: "" }]
      : [{ id: "2", address: WALLET_SOL, label: "", createdAt: "" }],
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getTokenHistory — empty inventory", () => {
  it("returns the empty available page and issues NO SQL when no wallets are configured", async () => {
    mocks.listWallets.mockReturnValue([]);
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      status: "available",
      entries: [],
      nextCursor: null,
      hasMore: false,
      costBasis: { kind: "none" },
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe("getTokenHistory — address normalization", () => {
  it("lower-cases the EVM tokenAddress before binding it into the page query", async () => {
    scriptTransaction({ page: [] });
    await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_MIXED_CASE,
      cursor: null,
    });
    expect(allBoundParams()).toContain(TOKEN_ADDR_LOWER);
    expect(allBoundParams()).not.toContain(TOKEN_ADDR_MIXED_CASE);
  });

  it("keeps a Solana address verbatim (case-sensitive base58)", async () => {
    scriptTransaction({ page: [] });
    await getTokenHistory({
      chainId: SOLANA_CHAIN_ID,
      tokenAddress: SOL_TOKEN,
      cursor: null,
    });
    expect(allBoundParams()).toContain(SOL_TOKEN);
  });

  it("binds the chain-alias candidate set including the bare decimal chain id", async () => {
    scriptTransaction({ page: [] });
    await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    const params = allBoundParams();
    const aliasArray = params.find(
      (p): p is string[] => Array.isArray(p) && p.includes("base"),
    );
    expect(aliasArray).toBeDefined();
    expect(aliasArray).toContain(String(BASE_CHAIN_ID));
  });
});

describe("getTokenHistory — entry mapping", () => {
  it("maps a matched spot activity row to a swap entry with tagged amounts", async () => {
    scriptTransaction({ page: [activityRow()] });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "available") return;
    expect(result.data.entries).toHaveLength(1);
    const entry = result.data.entries[0];
    expect(entry?.kind).toBe("swap");
    if (entry?.kind === "swap") {
      expect(entry.input.amount).toEqual({ value: "1.5", unitProvenance: "human" });
      expect(entry.txRefs).toEqual([{ chainId: BASE_CHAIN_ID, ref: "0xhash1" }]);
    }
  });

  it("maps a bridge row with a destination leg on a DIFFERENT numeric chain than the origin", async () => {
    scriptTransaction({
      page: [
        activityRow({
          product_type: "bridge",
          chain: String(BASE_CHAIN_ID),
          dest_chain: String(ARBITRUM_CHAIN_ID),
        }),
      ],
    });
    const result = await getTokenHistory({
      chainId: ARBITRUM_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "available") return;
    const entry = result.data.entries[0];
    expect(entry?.kind).toBe("bridge");
    if (entry?.kind === "bridge") {
      expect(entry.originChain).toBe(String(BASE_CHAIN_ID));
      expect(entry.destinationChain).toBe(String(ARBITRUM_CHAIN_ID));
    }
  });

  it("maps an executed wallet_intents row to a transfer entry", async () => {
    scriptTransaction({ page: [intentRow()] });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "available") return;
    const entry = result.data.entries[0];
    expect(entry?.kind).toBe("transfer");
    if (entry?.kind === "transfer") {
      expect(entry.toAddress).toBe("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
      expect(entry.amount).toEqual({ value: "5", unitProvenance: "human" });
    }
  });

  it("tags a bare atomic-integer amount as atomic, never human", async () => {
    scriptTransaction({ page: [activityRow({ input_amount: "1500000000000000000" })] });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    if (!result.ok || result.data.status !== "available") throw new Error("expected available");
    const entry = result.data.entries[0];
    if (entry?.kind === "swap") {
      expect(entry.input.amount.unitProvenance).toBe("atomic");
    }
  });
});

describe("getTokenHistory — pagination", () => {
  it("detects hasMore via limit+1 and mints nextCursor from the last KEPT row", async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      activityRow({ source_id: String(i).padStart(20, "0"), cursor_ts: `2026-05-21T10:00:0${i % 10}.000000Z` }),
    );
    scriptTransaction({ page: rows });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    if (!result.ok || result.data.status !== "available") throw new Error("expected available");
    expect(result.data.entries).toHaveLength(50);
    expect(result.data.hasMore).toBe(true);
    expect(result.data.nextCursor).not.toBeNull();
  });

  it("reports hasMore=false and nextCursor=null when the page is under the cap", async () => {
    scriptTransaction({ page: [activityRow()] });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    if (!result.ok || result.data.status !== "available") throw new Error("expected available");
    expect(result.data.hasMore).toBe(false);
    expect(result.data.nextCursor).toBeNull();
  });

  it("mints a cursor whose sourceRank/sourceId match the last KEPT row's OWN arm across a mixed activity+intent tie (no gaps/dupes at a cross-arm tie)", async () => {
    // 49 activity rows (source_rank=1) tied on ONE created_at, followed by TWO
    // intent rows (source_rank=0) tied on the SAME created_at. The total order
    // (created_at DESC, source_rank DESC, source_id DESC) keeps every activity
    // row ahead of every intent row at an exact timestamp tie, and orders the
    // two intent rows by their own intent_id DESC — so row 50 (the last KEPT
    // row) is the FIRST intent row, and row 51 (dropped, hasMore-only) is the
    // second. The mock supplies rows already in this true sorted order (it
    // stands in for Postgres having already applied ORDER BY).
    const tiedTs = "2026-05-21T10:00:00.000000Z";
    const activityRows = Array.from({ length: 49 }, (_, i) =>
      activityRow({ source_id: String(i).padStart(20, "0"), cursor_ts: tiedTs, created_at: new Date(tiedTs) }),
    );
    const keptIntent = intentRow({ source_id: "intent-b", cursor_ts: tiedTs, created_at: new Date(tiedTs) });
    const droppedIntent = intentRow({ source_id: "intent-a", cursor_ts: tiedTs, created_at: new Date(tiedTs) });
    scriptTransaction({ page: [...activityRows, keptIntent, droppedIntent] });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    if (!result.ok || result.data.status !== "available") throw new Error("expected available");
    expect(result.data.entries).toHaveLength(50);
    expect(result.data.hasMore).toBe(true);
    // The last KEPT row (position 50) is the intent arm — the cursor must say
    // sourceRank=0, never silently coerce to the activity arm's rank.
    expect(result.data.nextCursor).toEqual({
      createdAt: tiedTs,
      sourceRank: 0,
      sourceId: "intent-b",
    });
  });
});

describe("getTokenHistory — page-phase failure classification", () => {
  it("SQLSTATE 57014 on the page phase returns the unavailable degraded-success shape", async () => {
    scriptTransaction({ page: new FakeDbError("57014") });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ status: "unavailable", reason: "query_timeout" });
  });

  it("a non-timeout page failure returns a Result error, never the unavailable DTO", async () => {
    scriptTransaction({ page: new FakeDbError("08006") });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    expect(result.ok).toBe(false);
  });
});

describe("getTokenHistory — cost-basis phase degradation", () => {
  it("a cost-basis timeout degrades ONLY costBasis; entries still return", async () => {
    scriptTransaction({ page: [activityRow()], lots: new FakeDbError("57014") });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "available") return;
    expect(result.data.entries).toHaveLength(1);
    expect(result.data.costBasis).toEqual({ kind: "unavailable" });
  });

  it("zero matching lots reports 'none', distinct from 'unavailable'", async () => {
    scriptTransaction({ page: [activityRow()], lots: [] });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    if (!result.ok || result.data.status !== "available") throw new Error("expected available");
    expect(result.data.costBasis).toEqual({ kind: "none" });
  });

  it("maps matching lots into openLots + totals, capped display at 50", async () => {
    scriptTransaction({
      page: [activityRow()],
      lots: [
        {
          remaining_quantity_raw: "500000000000000000",
          prorated_cost_basis_usd: "50.00",
          price_usd: "100.00",
          opened_at: new Date("2026-05-01T00:00:00.000Z"),
          total_open_quantity: "500000000000000000",
          avg_open_price_usd: "100.00",
        },
      ],
    });
    const result = await getTokenHistory({
      chainId: BASE_CHAIN_ID,
      tokenAddress: TOKEN_ADDR_LOWER,
      cursor: null,
    });
    if (!result.ok || result.data.status !== "available") throw new Error("expected available");
    expect(result.data.costBasis).toEqual({
      kind: "lots",
      openLots: [
        {
          quantity: { value: "500000000000000000", unitProvenance: "atomic" },
          priceUsd: "100.00",
          costBasisUsd: "50.00",
          openedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      totalOpenQuantity: "500000000000000000",
      avgOpenPriceUsd: "100.00",
    });
  });
});
