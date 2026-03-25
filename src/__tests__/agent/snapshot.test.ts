import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecFile = vi.fn();
const mockQuery = vi.fn();
const mockGetLatest = vi.fn();
const mockInsertSnapshot = vi.fn();

vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }));
vi.mock("../../agent/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
vi.mock("../../agent/db/repos/snapshots.js", () => ({
  getLatest: () => mockGetLatest(),
  insertSnapshot: (...args: unknown[]) => mockInsertSnapshot(...args),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../khalani/chains.js", () => ({ CHAIN_ALIASES: {} }));
vi.mock("../../kyberswap/chains.js", () => ({
  getKyberChains: () => [{ chainId: 1, slug: "ethereum" }],
  resolveChainSlug: (s: string) => s,
}));

const { takeSnapshot } = await import("../../agent/snapshot.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([]);
  mockGetLatest.mockResolvedValue(null);
  mockInsertSnapshot.mockResolvedValue(1);
});

function mockCliSuccess(output: Record<string, unknown>) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify(output), "");
    },
  );
}

describe("takeSnapshot", () => {
  it("captures EVM token positions with decimals", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      if (args.includes("eip155")) {
        cb(null, JSON.stringify({
          success: true,
          tokens: [{
            chainId: 1, address: "0xabc", symbol: "USDC", decimals: 6,
            extensions: { balance: 1000000, price: { usd: 1.0 } },
          }],
        }), "");
      } else if (args.includes("solana")) {
        cb(null, JSON.stringify({ success: true, tokens: [] }), "");
      } else {
        cb(null, JSON.stringify({ success: true, balance: "1.0", usdValue: 0.5 }), "");
      }
    });

    await takeSnapshot("test");

    expect(mockInsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "test",
      }),
    );

    const call = mockInsertSnapshot.mock.calls[0][0];
    // 1000000 / 10^6 = 1.0, * $1.0 = $1.0
    const evmPos = call.positions.find((p: any) => p.symbol === "USDC");
    expect(evmPos).toBeDefined();
    expect(Number(evmPos.amount)).toBeCloseTo(1.0);
    expect(evmPos.usdValue).toBeCloseTo(1.0);
  });

  it("captures Solana token positions", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      if (args.includes("eip155")) {
        cb(null, JSON.stringify({ success: true, tokens: [] }), "");
      } else if (args.includes("solana")) {
        cb(null, JSON.stringify({
          success: true,
          tokens: [{
            chainId: 0, address: "native", symbol: "SOL", decimals: 9,
            extensions: { balance: 2000000000, price: { usd: 150.0 } },
          }],
        }), "");
      } else {
        cb(null, JSON.stringify({ success: true, balance: "0", usdValue: 0 }), "");
      }
    });

    await takeSnapshot();
    const call = mockInsertSnapshot.mock.calls[0][0];
    const solPos = call.positions.find((p: any) => p.chain === "solana");
    expect(solPos).toBeDefined();
    // 2000000000 / 10^9 = 2.0, * $150 = $300
    expect(Number(solPos.amount)).toBeCloseTo(2.0);
    expect(solPos.usdValue).toBeCloseTo(300.0);
  });

  it("skips tokens with NaN balance", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      if (args.includes("eip155")) {
        cb(null, JSON.stringify({
          success: true,
          tokens: [{
            chainId: 1, symbol: "BAD", decimals: 18,
            extensions: { balance: "not_a_number", price: { usd: 1.0 } },
          }],
        }), "");
      } else if (args.includes("solana")) {
        cb(null, JSON.stringify({ success: true, tokens: [] }), "");
      } else {
        cb(null, JSON.stringify({ success: true, balance: "0" }), "");
      }
    });

    await takeSnapshot();
    const call = mockInsertSnapshot.mock.calls[0][0];
    const badPos = call.positions.find((p: any) => p.symbol === "BAD");
    expect(badPos).toBeUndefined();
  });

  it("calculates P&L vs previous snapshot", async () => {
    mockGetLatest.mockResolvedValue({ totalUsd: 100.0 });
    mockCliSuccess({ success: true, tokens: [] });
    // 0G balance fallback
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      if (args.includes("eip155") || args.includes("solana")) {
        cb(null, JSON.stringify({ success: true, tokens: [] }), "");
      } else {
        cb(null, JSON.stringify({ success: true, balance: "10", usdValue: 150 }), "");
      }
    });

    await takeSnapshot();
    const call = mockInsertSnapshot.mock.calls[0][0];
    expect(call.pnlVsPrev).toBe(150 - 100);
    expect(call.pnlPctVsPrev).toBe(50);
  });

  it("handles CLI failure gracefully", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error("CLI not found"), "", "");
    });

    // Should not throw
    const id = await takeSnapshot();
    expect(id).toBe(1);
    expect(mockInsertSnapshot).toHaveBeenCalled();
  });

  it("adds 0G native balance fallback when not in EVM positions", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      if (args.includes("eip155") || args.includes("solana")) {
        cb(null, JSON.stringify({ success: true, tokens: [] }), "");
      } else if (args.includes("balance")) {
        cb(null, JSON.stringify({ success: true, balance: "5.0", usdValue: 2.5 }), "");
      } else {
        cb(new Error("unknown"), "", "");
      }
    });

    await takeSnapshot();
    const call = mockInsertSnapshot.mock.calls[0][0];
    const ogPos = call.positions.find((p: any) => p.chain === "0g" && p.symbol === "0G");
    expect(ogPos).toBeDefined();
    expect(ogPos.amount).toBe("5.0");
  });
});
