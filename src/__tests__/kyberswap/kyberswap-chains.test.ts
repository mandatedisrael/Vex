import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveChainSlug,
  chainIdToSlug,
  slugToChainId,
  getChainFeatures,
  chainSupportsFeature,
  getKyberChains,
  setCachedDynamicChains,
  getCachedDynamicChains,
  clearDynamicChainsCache,
} from "@tools/kyberswap/chains.js";
import { EchoError } from "../../errors.js";

describe("resolveChainSlug", () => {
  it("accepts exact slug", () => {
    expect(resolveChainSlug("ethereum")).toBe("ethereum");
    expect(resolveChainSlug("arbitrum")).toBe("arbitrum");
    expect(resolveChainSlug("base")).toBe("base");
    expect(resolveChainSlug("megaeth")).toBe("megaeth");
  });

  it("resolves aliases", () => {
    expect(resolveChainSlug("eth")).toBe("ethereum");
    expect(resolveChainSlug("arb")).toBe("arbitrum");
    expect(resolveChainSlug("poly")).toBe("polygon");
    expect(resolveChainSlug("matic")).toBe("polygon");
    expect(resolveChainSlug("op")).toBe("optimism");
    expect(resolveChainSlug("avax")).toBe("avalanche");
    expect(resolveChainSlug("bera")).toBe("berachain");
    expect(resolveChainSlug("zk")).toBe("zksync");
    expect(resolveChainSlug("era")).toBe("zksync");
  });

  it("accepts ZaaS-only chain slugs", () => {
    expect(resolveChainSlug("scroll")).toBe("scroll");
    expect(resolveChainSlug("zksync")).toBe("zksync");
  });

  it("is case-insensitive", () => {
    expect(resolveChainSlug("Ethereum")).toBe("ethereum");
    expect(resolveChainSlug("ARBITRUM")).toBe("arbitrum");
    expect(resolveChainSlug("ETH")).toBe("ethereum");
  });

  it("trims whitespace", () => {
    expect(resolveChainSlug("  eth  ")).toBe("ethereum");
    expect(resolveChainSlug(" base ")).toBe("base");
  });

  it("throws KYBER_UNSUPPORTED_CHAIN for unknown", () => {
    expect(() => resolveChainSlug("solana")).toThrow(EchoError);
    expect(() => resolveChainSlug("solana")).toThrow(/Unsupported KyberSwap chain/);
    expect(() => resolveChainSlug("")).toThrow(EchoError);
    expect(() => resolveChainSlug("0g")).toThrow(EchoError);
  });
});

describe("chainIdToSlug", () => {
  it("returns slug for known IDs", () => {
    expect(chainIdToSlug(1)).toBe("ethereum");
    expect(chainIdToSlug(56)).toBe("bsc");
    expect(chainIdToSlug(42161)).toBe("arbitrum");
    expect(chainIdToSlug(8453)).toBe("base");
    expect(chainIdToSlug(4326)).toBe("megaeth");
  });

  it("returns undefined for unknown IDs", () => {
    expect(chainIdToSlug(999999)).toBeUndefined();
    expect(chainIdToSlug(16661)).toBeUndefined(); // 0G not supported
  });
});

describe("slugToChainId", () => {
  it("returns chain ID for known slugs", () => {
    expect(slugToChainId("ethereum")).toBe(1);
    expect(slugToChainId("bsc")).toBe(56);
    expect(slugToChainId("polygon")).toBe(137);
    expect(slugToChainId("base")).toBe(8453);
  });

  it("throws for unknown slug", () => {
    expect(() => slugToChainId("unknown" as any)).toThrow(EchoError);
  });
});

describe("getChainFeatures", () => {
  it("returns all features for Ethereum", () => {
    const f = getChainFeatures("ethereum");
    expect(f.aggregator).toBe(true);
    expect(f.limitOrder).toBe(true);
    expect(f.zaas).toBe(true);
  });

  it("returns zaas=false for Mantle", () => {
    const f = getChainFeatures("mantle");
    expect(f.aggregator).toBe(true);
    expect(f.limitOrder).toBe(true);
    expect(f.zaas).toBe(false);
  });

  it("returns zaas=false for MegaETH", () => {
    const f = getChainFeatures("megaeth");
    expect(f.aggregator).toBe(true);
    expect(f.zaas).toBe(false);
  });

  it("throws for unknown slug", () => {
    expect(() => getChainFeatures("unknown" as any)).toThrow(EchoError);
  });
});

describe("chainSupportsFeature", () => {
  it("returns true for supported features", () => {
    expect(chainSupportsFeature("ethereum", "aggregator")).toBe(true);
    expect(chainSupportsFeature("ethereum", "zaas")).toBe(true);
    expect(chainSupportsFeature("arbitrum", "limitOrder")).toBe(true);
  });

  it("returns false for unsupported features", () => {
    expect(chainSupportsFeature("mantle", "zaas")).toBe(false);
    expect(chainSupportsFeature("megaeth", "zaas")).toBe(false);
    expect(chainSupportsFeature("scroll", "aggregator")).toBe(false);
    expect(chainSupportsFeature("zksync", "limitOrder")).toBe(false);
  });

  it("returns true for ZaaS-only chains' zaas feature", () => {
    expect(chainSupportsFeature("scroll", "zaas")).toBe(true);
    expect(chainSupportsFeature("zksync", "zaas")).toBe(true);
  });
});

describe("getKyberChains", () => {
  it("returns 20 chains", () => {
    const chains = getKyberChains();
    expect(chains).toHaveLength(20);
  });

  it("each chain has required fields", () => {
    for (const chain of getKyberChains()) {
      expect(chain.slug).toBeTruthy();
      expect(chain.chainId).toBeGreaterThan(0);
      expect(chain.name).toBeTruthy();
      expect(typeof chain.aggregator).toBe("boolean");
      expect(typeof chain.limitOrder).toBe("boolean");
      expect(typeof chain.zaas).toBe("boolean");
    }
  });

  it("aggregator-enabled chains have aggregator=true", () => {
    const aggregatorChains = getKyberChains().filter((c) => c.aggregator);
    expect(aggregatorChains.length).toBe(18);
  });

  it("ZaaS-only chains have aggregator=false and zaas=true", () => {
    const zaasOnly = getKyberChains().filter((c) => !c.aggregator && c.zaas);
    expect(zaasOnly.map((c) => c.slug).sort()).toEqual(["scroll", "zksync"]);
  });
});

describe("zaas catalog consistency", () => {
  it("every zaas:true chain has an entry in zap-dexes catalog", async () => {
    const { getSupportedZapChains } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
    const zaasChains = getKyberChains().filter(c => c.zaas).map(c => c.slug);
    const catalogChains = getSupportedZapChains();
    const missing = zaasChains.filter(slug => !catalogChains.includes(slug));
    expect(missing).toEqual([]);
  });
});

describe("dynamic chain cache", () => {
  beforeEach(() => {
    clearDynamicChainsCache();
  });

  it("returns null when cache is empty", () => {
    expect(getCachedDynamicChains()).toBeNull();
  });

  it("returns chains after set", () => {
    const chains = [{ chainId: 1, chainName: "ethereum", displayName: "Ethereum", state: "active" as const }];
    setCachedDynamicChains(chains);
    expect(getCachedDynamicChains()).toEqual(chains);
  });

  it("returns null after clear", () => {
    setCachedDynamicChains([{ chainId: 1, chainName: "ethereum", displayName: "Ethereum", state: "active" as const }]);
    clearDynamicChainsCache();
    expect(getCachedDynamicChains()).toBeNull();
  });

  it("expires after TTL", () => {
    const chains = [{ chainId: 1, chainName: "ethereum", displayName: "Ethereum", state: "active" as const }];
    setCachedDynamicChains(chains);

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61 * 60 * 1000); // 61 minutes
    expect(getCachedDynamicChains()).toBeNull();

    vi.restoreAllMocks();
  });
});
