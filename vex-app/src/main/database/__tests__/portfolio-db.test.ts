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
 * Script the three queries (live total, token lines, snapshot) in order.
 * The portfolio-db issues exactly these three when the allow-list is
 * non-empty.
 */
function scriptThreeQueries(opts: {
  live: unknown;
  tokens: ReadonlyArray<Record<string, unknown>>;
  snapshot: Record<string, unknown> | null;
  /** Optional older complete-cycle group — drives PnL = latest.total − prev.total. */
  previousSnapshot?: Record<string, unknown> | null;
}): void {
  const snapshotRows = [opts.snapshot, opts.previousSnapshot ?? null].filter(
    (r): r is Record<string, unknown> => r != null,
  );
  mocks.query
    .mockResolvedValueOnce({ rows: [{ live: opts.live }] })
    .mockResolvedValueOnce({ rows: opts.tokens })
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
    scriptThreeQueries({
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

    // Every SELECT (live + tokens + snapshot) carries the address array as $1.
    const addressParams = mocks.query.mock.calls.map((c) => {
      const p = c[1];
      return Array.isArray(p) ? p[0] : undefined;
    });
    expect(addressParams).toHaveLength(3);
    for (const p of addressParams) {
      expect(p).toEqual([WALLET_A, WALLET_B, SOL_ADDR]);
    }
    // Snapshot completeness param is the address count.
    const snapshotCall = mocks.query.mock.calls[2];
    expect(snapshotCall?.[1]?.[1]).toBe(3);
  });

  it("does NOT lowercase addresses (raw join key preserved)", async () => {
    mocks.listWallets.mockImplementation((family: string) =>
      family === "evm" ? [{ id: "1", address: WALLET_A, label: "", createdAt: "" }] : [],
    );
    scriptThreeQueries({ live: "0", tokens: [], snapshot: null });
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
    scriptThreeQueries({
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
    scriptThreeQueries({ live: "0", tokens: [], snapshot: null });
    await getPortfolio({ scope: "session", sessionId: SESSION });
    const snapshotCall = mocks.query.mock.calls[2];
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
    scriptThreeQueries({ live: "10", tokens: [], snapshot: null });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.snapshotTotalUsd).toBeNull();
    expect(result.data.pnlVsPrev).toBeNull();
    expect(result.data.snapshotAt).toBeNull();
    expect(result.data.liveTotalUsd).toBe(10);
  });

  it("tolerates a BIGINT chain_id beyond the JS safe-integer range via Number()", async () => {
    scriptThreeQueries({
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
    scriptThreeQueries({
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
    scriptThreeQueries({ live: "1", tokens: [], snapshot: null });
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
    scriptThreeQueries({
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
    const snapshotSql = String(mocks.query.mock.calls[2]?.[0] ?? "");
    expect(snapshotSql).toContain("LIMIT 2");
    expect(snapshotSql).not.toContain("pnl_vs_prev");
  });

  it("leaves PnL null when only one complete cycle exists", async () => {
    scriptThreeQueries({
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
    scriptThreeQueries({ live: "1", tokens: rows, snapshot: null });
    const result = await getPortfolio({ scope: "global" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tokens).toHaveLength(500);
    const tokenSql = String(mocks.query.mock.calls[1]?.[0] ?? "");
    expect(tokenSql).toContain("LIMIT 500");
  });
});
