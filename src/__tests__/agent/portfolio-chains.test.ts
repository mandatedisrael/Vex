import { describe, it, expect, vi } from "vitest";

vi.mock("../../khalani/chains.js", () => ({
  CHAIN_ALIASES: {
    ethereum: 1,
    polygon: 137,
    arbitrum: 42161,
    sol: 999999,
    zerogravity: 888888,
  },
}));
vi.mock("../../kyberswap/chains.js", () => ({
  getKyberChains: () => [
    { chainId: 1, slug: "ethereum" },
    { chainId: 137, slug: "polygon" },
    { chainId: 42161, slug: "arbitrum" },
  ],
  resolveChainSlug: (input: string) => {
    const map: Record<string, string> = { ethereum: "ethereum", polygon: "polygon", arbitrum: "arbitrum" };
    if (map[input]) return map[input];
    throw new Error(`Unknown chain: ${input}`);
  },
}));

const { resolvePortfolioChainName, normalizePortfolioChain, getDefaultTrackedChains } =
  await import("../../agent/portfolio-chains.js");

describe("resolvePortfolioChainName", () => {
  it("resolves known chainId to slug", () => {
    expect(resolvePortfolioChainName(1)).toBe("ethereum");
    expect(resolvePortfolioChainName(137)).toBe("polygon");
  });

  it("returns evm-{chainId} for unknown chainId", () => {
    expect(resolvePortfolioChainName(99999)).toBe("evm-99999");
  });
});

describe("normalizePortfolioChain", () => {
  it("normalizes 'sol' to 'solana'", () => {
    expect(normalizePortfolioChain("sol")).toBe("solana");
    expect(normalizePortfolioChain("solana")).toBe("solana");
  });

  it("normalizes '0g' and 'zerogravity' to '0g'", () => {
    expect(normalizePortfolioChain("0g")).toBe("0g");
    expect(normalizePortfolioChain("zerogravity")).toBe("0g");
  });

  it("normalizes numeric chainId string to slug", () => {
    expect(normalizePortfolioChain("1")).toBe("ethereum");
    expect(normalizePortfolioChain("137")).toBe("polygon");
  });

  it("normalizes known chain name via resolveChainSlug", () => {
    expect(normalizePortfolioChain("ethereum")).toBe("ethereum");
  });

  it("returns lowercased input for unknown chain", () => {
    expect(normalizePortfolioChain("UNKNOWN_CHAIN")).toBe("unknown_chain");
  });

  it("handles empty input", () => {
    expect(normalizePortfolioChain("")).toBe("");
    expect(normalizePortfolioChain("  ")).toBe("  ");
  });

  it("case insensitive", () => {
    expect(normalizePortfolioChain("SOL")).toBe("solana");
    expect(normalizePortfolioChain("Solana")).toBe("solana");
  });
});

describe("getDefaultTrackedChains", () => {
  it("includes 0g and solana", () => {
    const chains = getDefaultTrackedChains();
    expect(chains).toContain("0g");
    expect(chains).toContain("solana");
  });

  it("includes KyberSwap chains", () => {
    const chains = getDefaultTrackedChains();
    expect(chains).toContain("ethereum");
    expect(chains).toContain("polygon");
  });

  it("has no duplicates", () => {
    const chains = getDefaultTrackedChains();
    expect(new Set(chains).size).toBe(chains.length);
  });
});
