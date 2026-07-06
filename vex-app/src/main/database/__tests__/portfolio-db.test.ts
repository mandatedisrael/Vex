/**
 * portfolio-db tests — server-side address resolution + dual-scope
 * aggregation, with NO real DB.
 *
 * Mirrors usage-db.test.ts (mocked `pg` Client + `db-config` + logger).
 * Additionally mocks the two server-side address sources:
 *  - `@vex-lib/wallet.js` `listWallets` (global inventory), and
 *  - `../sessions-db.js` `getSessionWalletScope` (session scope).
 *
 * Security invariants under test:
 *  - empty allow-list (no wallets / empty session scope) → empty DTO,
 *    and NO SQL is ever issued (fail closed BEFORE query);
 *  - every SELECT binds `wallet_address = ANY($1::text[])` with the
 *    resolved address array (never a renderer-supplied address);
 *  - CROSS-SESSION ISOLATION: a session scoped to wallet A binds ONLY
 *    wallet A's address — wallet B's address never appears in any param;
 *  - NUMERIC/float8 coercion + null-snapshot fallback;
 *  - a failed session-scope read propagates (fail closed).
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
  getSessionWalletScope: vi.fn(),
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

vi.mock("../sessions-db.js", () => ({
  getSessionWalletScope: mocks.getSessionWalletScope,
}));

vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { getPortfolio } = await import("../portfolio-db.js");

const SESSION = "00000000-0000-4000-8000-00000000aaaa";
const WALLET_A = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const WALLET_B = "0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb";
const SOL_ADDR = "So11111111111111111111111111111111111111112";

function scopeOk(evmAddr: string | null, solAddr: string | null) {
  return {
    ok: true as const,
    data: {
      evm: evmAddr ? { id: "evm_1", address: evmAddr } : null,
      solana: solAddr ? { id: "sol_1", address: solAddr } : null,
    },
  };
}

/** All bound params across every issued query call, flattened. */
function allBoundParams(): unknown[] {
  return mocks.query.mock.calls.flatMap((call) => {
    const params = call[1];
    return Array.isArray(params) ? params.flat() : [];
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
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Script the four queries (live total, token lines, per-chain breakdown,
 * snapshot) in order. The portfolio-db issues exactly these four when the
 * allow-list is non-empty.
 */
function scriptPortfolioQueries(opts: {
  live: unknown;
  tokens: ReadonlyArray<Record<string, unknown>>;
  snapshot: Record<string, unknown> | null;
  /** Optional older complete-cycle group — drives PnL = latest.total − prev.total. */
  previousSnapshot?: Record<string, unknown> | null;
  /** Flat breakdown rows (chain totals repeated per top-token line). */
  breakdown?: ReadonlyArray<Record<string, unknown>>;
}): void {
  const snapshotRows = [opts.snapshot, opts.previousSnapshot ?? null].filter(
    (r): r is Record<string, unknown> => r != null,
  );
  mocks.query
    .mockResolvedValueOnce({ rows: [{ live: opts.live }] })
    .mockResolvedValueOnce({ rows: opts.tokens })
    .mockResolvedValueOnce({ rows: opts.breakdown ?? [] })
    .mockResolvedValueOnce({ rows: snapshotRows });
}

describe("portfolio-db getPortfolio — global scope", () => {
  it("returns the empty DTO and issues NO SQL when the inventory is empty", async () => {
    mocks.listWallets.mockReturnValue([]);
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      scope: "global",
      walletCount: 0,
      liveTotalUsd: 0,
      snapshotTotalUsd: null,
      pnlVsPrev: null,
      snapshotAt: null,
      tokens: [],
      chains: [],
    });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("aggregates inventory addresses and binds them into every ANY($1) filter", async () => {
    // evm family returns A + B; solana family returns the sol address.
    mocks.listWallets.mockImplementation((family: string) =>
      family === "evm"
        ? [
            { id: "1", address: WALLET_A, label: "", createdAt: "" },
            { id: "2", address: WALLET_B, label: "", createdAt: "" },
          ]
        : [{ id: "3", address: SOL_ADDR, label: "", createdAt: "" }],
    );
    scriptPortfolioQueries({
      live: "1234.5",
      tokens: [
        { chain_id: "1", token_symbol: "ETH", usd: "1000" },
        { chain_id: "137", token_symbol: "USDC", usd: "234.5" },
      ],
      snapshot: {
        snapshot_group_id: "grp",
        total: "1200",
        at: "2026-05-21T10:00:00.000Z",
      },
      // PnL is latest.total − previous.total = 1200 − 1165.5 = 34.5.
      previousSnapshot: {
        snapshot_group_id: "grp0",
        total: "1165.5",
        at: "2026-05-20T10:00:00.000Z",
      },
    });

    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scope).toBe("global");
    expect(result.data.walletCount).toBe(3);
    expect(result.data.liveTotalUsd).toBeCloseTo(1234.5, 4);
    expect(result.data.snapshotTotalUsd).toBeCloseTo(1200, 4);
    expect(result.data.pnlVsPrev).toBeCloseTo(34.5, 4);
    expect(result.data.snapshotAt).toBe("2026-05-21T10:00:00.000Z");
    expect(result.data.tokens).toEqual([
      { chainId: 1, symbol: "ETH", balanceUsd: 1000 },
      { chainId: 137, symbol: "USDC", balanceUsd: 234.5 },
    ]);

    // Every SELECT (live + tokens + breakdown + snapshot) carries the
    // address array as $1.
    const addressParams = mocks.query.mock.calls.map((c) => {
      const p = c[1];
      return Array.isArray(p) ? p[0] : undefined;
    });
    expect(addressParams).toHaveLength(4);
    for (const p of addressParams) {
      expect(p).toEqual([WALLET_A, WALLET_B, SOL_ADDR]);
    }
    // Snapshot completeness param is the address count.
    const snapshotCall = mocks.query.mock.calls[3];
    expect(snapshotCall?.[1]?.[1]).toBe(3);
  });

  it("does NOT lowercase addresses (raw join key preserved)", async () => {
    mocks.listWallets.mockImplementation((family: string) =>
      family === "evm" ? [{ id: "1", address: WALLET_A, label: "", createdAt: "" }] : [],
    );
    scriptPortfolioQueries({ live: "0", tokens: [], snapshot: null });
    await getPortfolio({ scope: "global" });
    const bound = allBoundParams();
    expect(bound).toContain(WALLET_A); // mixed-case kept verbatim
    expect(bound).not.toContain(WALLET_A.toLowerCase());
  });
});

describe("portfolio-db getPortfolio — session scope", () => {
  it("returns the empty DTO and issues NO SQL when the session scope is empty", async () => {
    mocks.getSessionWalletScope.mockResolvedValue(scopeOk(null, null));
    const result = await getPortfolio({ scope: "session", sessionId: SESSION });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scope).toBe("session");
    expect(result.data.walletCount).toBe(0);
    expect(result.data.tokens).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("CROSS-SESSION ISOLATION: a session scoped to wallet A never returns wallet B's rows", async () => {
    // The session is scoped to wallet A only. Even though the DB physically
    // holds rows for wallet B, the ANY($1) filter binds ONLY wallet A — the
    // mock proves the param set excludes B entirely.
    mocks.getSessionWalletScope.mockResolvedValue(scopeOk(WALLET_A, null));
    scriptPortfolioQueries({
      live: "500",
      tokens: [{ chain_id: "1", token_symbol: "ETH", usd: "500" }],
      snapshot: null,
    });

    const result = await getPortfolio({ scope: "session", sessionId: SESSION });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.walletCount).toBe(1);

    const bound = allBoundParams();
    expect(bound).toContain(WALLET_A);
    // The decisive isolation assertion: wallet B is NEVER bound into any query.
    expect(bound).not.toContain(WALLET_B);

    // And the address array bound as $1 is exactly [WALLET_A] on every call.
    for (const call of mocks.query.mock.calls) {
      const arr = Array.isArray(call[1]) ? call[1][0] : undefined;
      expect(arr).toEqual([WALLET_A]);
    }
  });

  it("propagates a failed session-scope read (fail closed, no SQL)", async () => {
    mocks.getSessionWalletScope.mockResolvedValue({
      ok: false as const,
      error: {
        code: "internal.unexpected",
        domain: "internal",
        message: "boom",
        retryable: true,
        userActionable: false,
        redacted: true,
      },
    });
    const result = await getPortfolio({ scope: "session", sessionId: SESSION });
    expect(result.ok).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("binds the address COUNT as the snapshot completeness param", async () => {
    mocks.getSessionWalletScope.mockResolvedValue(scopeOk(WALLET_A, SOL_ADDR));
    scriptPortfolioQueries({ live: "0", tokens: [], snapshot: null });
    await getPortfolio({ scope: "session", sessionId: SESSION });
    const snapshotCall = mocks.query.mock.calls[3];
    // [addressArray, addressCount]
    expect(snapshotCall?.[1]?.[1]).toBe(2);
  });
});

describe("portfolio-db getPortfolio — coercion + fallback", () => {
  beforeEach(() => {
    mocks.listWallets.mockImplementation((family: string) =>
      family === "evm" ? [{ id: "1", address: WALLET_A, label: "", createdAt: "" }] : [],
    );
  });

  it("collapses an absent snapshot to null total/pnl/at", async () => {
    scriptPortfolioQueries({ live: "10", tokens: [], snapshot: null });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.snapshotTotalUsd).toBeNull();
    expect(result.data.pnlVsPrev).toBeNull();
    expect(result.data.snapshotAt).toBeNull();
    expect(result.data.liveTotalUsd).toBe(10);
  });

  it("tolerates a BIGINT chain_id beyond the JS safe-integer range via Number()", async () => {
    scriptPortfolioQueries({
      live: "1",
      tokens: [{ chain_id: "999999999999999999999", token_symbol: "X", usd: "1" }],
      snapshot: null,
    });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tokens).toHaveLength(1);
    // Number() yields a finite (lossy) value — tolerated, never null here.
    expect(result.data.tokens[0]?.chainId).toBe(Number("999999999999999999999"));
  });

  it("maps a null chain_id / null token_symbol to nulls", async () => {
    scriptPortfolioQueries({
      live: "1",
      tokens: [{ chain_id: null, token_symbol: null, usd: "1" }],
      snapshot: null,
    });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tokens[0]).toEqual({
      chainId: null,
      symbol: null,
      balanceUsd: 1,
    });
  });

  it("returns dbUnavailable (domain portfolio) when buildPoolConfig yields null", async () => {
    mocks.buildPoolConfig.mockResolvedValue(null);
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.domain).toBe("portfolio");
    expect(result.error.code).toBe("internal.unexpected");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns dbError (domain portfolio) when a query throws", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection reset"));
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.domain).toBe("portfolio");
    expect(result.error.code).toBe("internal.unexpected");
  });

  it("never logs raw addresses (only counts)", async () => {
    scriptPortfolioQueries({ live: "1", tokens: [], snapshot: null });
    await getPortfolio({ scope: "global" });
    const logged = mocks.log.info.mock.calls.flat().join(" ");
    expect(logged).not.toContain(WALLET_A);
    expect(logged).toContain("wallets=1");
  });
});

describe("portfolio-db getPortfolio — PnL + token cap (codex review)", () => {
  beforeEach(() => {
    mocks.listWallets.mockImplementation((family: string) =>
      family === "evm" ? [{ id: "1", address: WALLET_A, label: "", createdAt: "" }] : [],
    );
  });

  it("computes PnL as latest.total − previous.total over two complete cycles", async () => {
    scriptPortfolioQueries({
      live: "100",
      tokens: [],
      snapshot: { snapshot_group_id: "g1", total: "100", at: "2026-05-21T10:00:00.000Z" },
      previousSnapshot: { snapshot_group_id: "g0", total: "80", at: "2026-05-20T10:00:00.000Z" },
    });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.snapshotTotalUsd).toBeCloseTo(100, 4);
    expect(result.data.pnlVsPrev).toBeCloseTo(20, 4);
    // The snapshot query asks for the latest TWO groups and no longer sums
    // per-wallet pnl_vs_prev.
    const snapshotSql = String(mocks.query.mock.calls[3]?.[0] ?? "");
    expect(snapshotSql).toContain("LIMIT 2");
    expect(snapshotSql).not.toContain("pnl_vs_prev");
  });

  it("leaves PnL null when only one complete cycle exists", async () => {
    scriptPortfolioQueries({
      live: "100",
      tokens: [],
      snapshot: { snapshot_group_id: "g1", total: "100", at: "2026-05-21T10:00:00.000Z" },
    });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.snapshotTotalUsd).toBeCloseTo(100, 4);
    expect(result.data.pnlVsPrev).toBeNull();
  });

  it("caps token lines at 500 even if the DB returns more (no output-schema overflow)", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      chain_id: "1",
      token_symbol: `T${i}`,
      usd: String(501 - i),
    }));
    scriptPortfolioQueries({ live: "1", tokens: rows, snapshot: null });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tokens).toHaveLength(500);
    const tokenSql = String(mocks.query.mock.calls[1]?.[0] ?? "");
    expect(tokenSql).toContain("LIMIT 500");
  });
});

describe("portfolio-db getPortfolio — per-chain breakdown (codex plan review)", () => {
  beforeEach(() => {
    mocks.listWallets.mockImplementation((family: string) =>
      family === "evm" ? [{ id: "1", address: WALLET_A, label: "", createdAt: "" }] : [],
    );
  });

  it("issues a PURPOSE-BUILT window query (not a post-process of the capped flat list)", async () => {
    scriptPortfolioQueries({ live: "0", tokens: [], snapshot: null });
    await getPortfolio({ scope: "global" });
    const breakdownSql = String(mocks.query.mock.calls[2]?.[0] ?? "");
    // Window ranking per chain over the FULL balance set…
    expect(breakdownSql).toContain("ROW_NUMBER() OVER");
    expect(breakdownSql).toContain("PARTITION BY chain_id");
    // …NULL chain ids stay in the legacy flat list only…
    expect(breakdownSql).toContain("chain_id IS NOT NULL");
    // …only positive chain totals survive, bounded to the schema caps.
    expect(breakdownSql).toContain("HAVING SUM(usd) > 0");
    expect(breakdownSql).toContain("LIMIT 64");
    expect(breakdownSql).toContain("rn <= 3");
    // Same address allow-list binding as every other SELECT.
    const breakdownParams = mocks.query.mock.calls[2]?.[1];
    expect(Array.isArray(breakdownParams) ? breakdownParams[0] : undefined).toEqual([
      WALLET_A,
    ]);
  });

  it("assembles ordered chains with top-3 tokens and derives family from the chain id", async () => {
    scriptPortfolioQueries({
      live: "100",
      tokens: [],
      snapshot: null,
      breakdown: [
        // Solana chain (Khalani synthetic id) — total 60, two tokens.
        { chain_id: "20011000000", chain_total: "60", token_symbol: "SOL", token_usd: "50" },
        { chain_id: "20011000000", chain_total: "60", token_symbol: "BONK", token_usd: "10" },
        // Ethereum — total 40, one token.
        { chain_id: "1", chain_total: "40", token_symbol: "ETH", token_usd: "40" },
      ],
    });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chains).toEqual([
      {
        chainId: 20011000000,
        family: "solana",
        totalUsd: 60,
        tokens: [
          { symbol: "SOL", balanceUsd: 50 },
          { symbol: "BONK", balanceUsd: 10 },
        ],
      },
      {
        chainId: 1,
        family: "evm",
        totalUsd: 40,
        tokens: [{ symbol: "ETH", balanceUsd: 40 }],
      },
    ]);
  });

  it("drops non-positive chain totals and unparseable chain ids defensively", async () => {
    scriptPortfolioQueries({
      live: "10",
      tokens: [],
      snapshot: null,
      breakdown: [
        { chain_id: "1", chain_total: "10", token_symbol: "ETH", token_usd: "10" },
        // Should never arrive (SQL HAVING > 0) — the builder still drops them.
        { chain_id: "137", chain_total: "0", token_symbol: "POL", token_usd: "0" },
        { chain_id: "not-a-number", chain_total: "5", token_symbol: "X", token_usd: "5" },
      ],
    });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chains).toHaveLength(1);
    expect(result.data.chains[0]?.chainId).toBe(1);
  });

  it("keeps at most 3 tokens per chain and drops non-positive token lines", async () => {
    scriptPortfolioQueries({
      live: "10",
      tokens: [],
      snapshot: null,
      breakdown: [
        { chain_id: "1", chain_total: "10", token_symbol: "A", token_usd: "4" },
        { chain_id: "1", chain_total: "10", token_symbol: "B", token_usd: "3" },
        { chain_id: "1", chain_total: "10", token_symbol: "C", token_usd: "2" },
        // 4th line + a zero line — both must be dropped (schema max(3), >$0).
        { chain_id: "1", chain_total: "10", token_symbol: "D", token_usd: "1" },
        { chain_id: "1", chain_total: "10", token_symbol: "E", token_usd: "0" },
      ],
    });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chains[0]?.tokens).toEqual([
      { symbol: "A", balanceUsd: 4 },
      { symbol: "B", balanceUsd: 3 },
      { symbol: "C", balanceUsd: 2 },
    ]);
  });

  it("bounds the assembled chains at 64 (schema max) even on excess rows", async () => {
    const breakdown = Array.from({ length: 65 }, (_, i) => ({
      chain_id: String(1000 + i),
      chain_total: String(65 - i),
      token_symbol: `T${i}`,
      token_usd: String(65 - i),
    }));
    scriptPortfolioQueries({ live: "10", tokens: [], snapshot: null, breakdown });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chains).toHaveLength(64);
  });

  it("keeps equal-total chains contiguous (chain_id tie-breaker) — no duplicate entries", async () => {
    scriptPortfolioQueries({ live: "20", tokens: [], snapshot: null });
    await getPortfolio({ scope: "global" });
    // The ORDER BY must carry the deterministic chain_id tie-breaker: with
    // two equal totals Postgres could otherwise interleave rows by rank and
    // the single-pass grouper would emit duplicate chain entries.
    const breakdownSql = String(mocks.query.mock.calls[2]?.[0] ?? "");
    expect(breakdownSql).toContain(
      "ORDER BY t.chain_total DESC, t.chain_id ASC, r.rn ASC NULLS LAST",
    );
  });

  it("assembles two equal-total multi-token chains without splitting either", async () => {
    scriptPortfolioQueries({
      live: "20",
      tokens: [],
      snapshot: null,
      // Contiguous per chain (as the tie-broken ORDER BY guarantees).
      breakdown: [
        { chain_id: "1", chain_total: "10", token_symbol: "ETH", token_usd: "6" },
        { chain_id: "1", chain_total: "10", token_symbol: "USDC", token_usd: "4" },
        { chain_id: "8453", chain_total: "10", token_symbol: "USDC", token_usd: "7" },
        { chain_id: "8453", chain_total: "10", token_symbol: "WETH", token_usd: "3" },
      ],
    });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chains).toHaveLength(2);
    expect(result.data.chains.map((c) => c.chainId)).toEqual([1, 8453]);
    expect(result.data.chains[0]?.tokens).toHaveLength(2);
    expect(result.data.chains[1]?.tokens).toHaveLength(2);
  });

  it("a chain with a positive total but no positive token lines keeps an empty tokens list", async () => {
    scriptPortfolioQueries({
      live: "10",
      tokens: [],
      snapshot: null,
      breakdown: [
        // LEFT JOIN emits the chain with NULL token columns when no ranked
        // line survived the usd > 0 filter.
        { chain_id: "1", chain_total: "10", token_symbol: null, token_usd: null },
      ],
    });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chains).toEqual([
      { chainId: 1, family: "evm", totalUsd: 10, tokens: [] },
    ]);
  });
});
