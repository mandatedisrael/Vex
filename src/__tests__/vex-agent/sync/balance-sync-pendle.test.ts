/**
 * Pendle balance enrichment — G2#2 scope lock + merge dedup.
 *
 * The enrichment runs ONLY when the Khalani scan actually refreshed chain 1. A
 * selective sync scoped to another chain must NOT invoke the Pendle enrichment
 * (and therefore never synthesizes/replaces chain-1 rows).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockListWallets = vi.fn();
vi.mock("@tools/wallet/inventory.js", () => ({
  listWallets: (family: string) => mockListWallets(family),
}));

const mockScan = vi.fn();
vi.mock("@tools/khalani/balances.js", () => ({
  getTokenBalancesAcrossChains: (...args: unknown[]) => mockScan(...args),
}));

const mockGetCachedKhalaniChains = vi.fn();
const mockResolveChainId = vi.fn();
vi.mock("@tools/khalani/chains.js", () => ({
  getCachedKhalaniChains: () => mockGetCachedKhalaniChains(),
  resolveChainId: (...a: unknown[]) => mockResolveChainId(...a),
}));

vi.mock("../../../vex-agent/sync/local-chain-balance-sync.js", () => ({
  syncLocalChainForWallet: vi.fn().mockResolvedValue({ chainId: 0, tokensUpdated: 0, skipped: true }),
}));

const mockReplaceBalances = vi.fn().mockResolvedValue(0);
vi.mock("@vex-agent/db/repos/balances.js", () => ({
  replaceBalancesForChain: (...a: unknown[]) => mockReplaceBalances(...a),
  getBalances: vi.fn().mockResolvedValue([]),
  getBalancesByChain: vi.fn().mockResolvedValue([]),
  insertSnapshot: vi.fn().mockResolvedValue({ snapshotId: 1, pnlVsPrev: null }),
  getLatestSnapshot: vi.fn().mockResolvedValue(null),
  getSnapshotHistory: vi.fn().mockResolvedValue([]),
}));

// The unit under scope: spy the enrichment so we can assert IF/WHEN it is called.
const mockEnrich = vi.fn(async (_f: string, _a: string, rows: unknown) => rows);
vi.mock("../../../vex-agent/sync/pendle-enrichment.js", () => ({
  enrichChainOnePendleBalances: (...a: unknown[]) => mockEnrich(...(a as [string, string, unknown])),
}));

const { selectiveBalanceSync } = await import("../../../vex-agent/sync/balance-sync.js");

const EVM_A = "0xAAAaaa";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCachedKhalaniChains.mockResolvedValue([
    { id: 1, name: "Ethereum", type: "eip155" },
    { id: 8453, name: "Base", type: "eip155" },
  ]);
  mockResolveChainId.mockImplementation((hint: string) => {
    if (hint === "ethereum") return 1;
    if (hint === "base") return 8453;
    throw new Error("unsupported");
  });
  mockListWallets.mockImplementation((family: string) =>
    family === "solana" ? [] : [{ id: "evm_1", address: EVM_A, label: "EVM 1", createdAt: "" }],
  );
  // The scan echoes back exactly the chains it was asked to refresh.
  mockScan.mockImplementation((args: { chainIds?: number[] }) => ({
    tokens: [],
    scannedChainIds: args.chainIds ?? [],
    chainErrors: [],
  }));
});

describe("pendle enrichment scope lock (G2#2)", () => {
  it("runs the Pendle enrichment when the ETH (chain 1) selective sync refreshes chain 1", async () => {
    await selectiveBalanceSync("ethereum");
    expect(mockEnrich).toHaveBeenCalledTimes(1);
    expect(mockEnrich).toHaveBeenCalledWith("eip155", EVM_A, expect.any(Array));
  });

  it("does NOT run the Pendle enrichment for a non-ETH selective sync (base)", async () => {
    await selectiveBalanceSync("base");
    expect(mockEnrich).not.toHaveBeenCalled();
    // And chain 1 is never replaced by a base-scoped sync.
    for (const call of mockReplaceBalances.mock.calls) {
      expect(call[1]).not.toBe(1);
    }
  });
});
