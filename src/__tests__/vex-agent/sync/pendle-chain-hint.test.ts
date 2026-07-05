/**
 * Pendle post-mutation sync seeding (G2#5) — the pendle captures' chain slug
 * ("ethereum") resolves to chain 1, so a buy/sell/redeem seeds a selective sync
 * of Ethereum.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetCachedKhalaniChains = vi.fn();
const mockResolveChainId = vi.fn();
vi.mock("@tools/khalani/chains.js", () => ({
  getCachedKhalaniChains: () => mockGetCachedKhalaniChains(),
  resolveChainId: (...a: unknown[]) => mockResolveChainId(...a),
}));
vi.mock("@tools/evm-chains/registry.js", () => ({
  resolveLocalChainId: () => undefined,
}));
vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { resolveChainHint } = await import("../../../vex-agent/sync/chains.js");
const { PENDLE_CHAIN_SLUG } = await import("../../../tools/pendle/chains.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCachedKhalaniChains.mockResolvedValue([{ id: 1, name: "Ethereum", type: "eip155" }]);
  mockResolveChainId.mockImplementation((hint: string) => {
    if (hint === "ethereum") return 1;
    throw new Error("unsupported");
  });
});

describe("pendle capture chain hint → selective sync (G2#5)", () => {
  it("the pendle capture slug is 'ethereum'", () => {
    expect(PENDLE_CHAIN_SLUG).toBe("ethereum");
  });

  it("resolveChainHint('ethereum') targets EVM chain 1", async () => {
    const resolved = await resolveChainHint(PENDLE_CHAIN_SLUG);
    expect(resolved.family).toBe("eip155");
    expect(resolved.chainIds).toEqual([1]);
  });
});
