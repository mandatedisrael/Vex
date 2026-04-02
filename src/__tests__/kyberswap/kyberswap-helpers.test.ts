import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveChain, resolveChainWithId, requireFeature, formatUsd, formatGas } from "@commands/kyberswap/helpers.js";
import { EchoError, ErrorCodes } from "../../errors.js";

// Mock on-chain reads for resolveTokenMetadata address path
vi.mock("../../tools/kyberswap/evm-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../tools/kyberswap/evm-utils.js")>();
  return {
    ...original,
    readErc20Metadata: vi.fn().mockResolvedValue({
      address: "0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed",
      symbol: "axlUSDC",
      name: "Axelar Wrapped USDC",
      decimals: 6,
      isNative: false,
    }),
  };
});

// Mock Token API for symbol path
vi.mock("../../tools/kyberswap/token-api/client.js", () => ({
  getKyberTokenApiClient: () => ({
    searchTokens: vi.fn()
      .mockImplementation((_chainIds: string, opts?: { name?: string; isWhitelisted?: boolean }) => {
        const name = opts?.name?.toLowerCase() ?? "";
        // Whitelisted search: USDC found, axlUSDC not found
        if (opts?.isWhitelisted === true) {
          if (name === "usdc") return Promise.resolve([{ address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", name: "USD Coin", decimals: 6 }]);
          return Promise.resolve([]);
        }
        // Broader search: axlUSDC found
        if (name === "axlusdc") return Promise.resolve([{ address: "0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed", symbol: "axlUSDC", name: "Axelar Wrapped USDC", decimals: 6 }]);
        if (name === "usdc") return Promise.resolve([{ address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", name: "USD Coin", decimals: 6 }]);
        return Promise.resolve([]);
      }),
  }),
}));

describe("resolveChain", () => {
  it("resolves slug", () => {
    expect(resolveChain("ethereum")).toBe("ethereum");
    expect(resolveChain("eth")).toBe("ethereum");
  });
});

describe("resolveChainWithId", () => {
  it("returns slug and chainId", () => {
    const result = resolveChainWithId("eth");
    expect(result.slug).toBe("ethereum");
    expect(result.chainId).toBe(1);
  });
});

describe("requireFeature", () => {
  it("does not throw for supported feature", () => {
    expect(() => requireFeature("ethereum", "aggregator")).not.toThrow();
    expect(() => requireFeature("ethereum", "zaas")).not.toThrow();
  });

  it("throws KYBER_UNSUPPORTED_CHAIN for unsupported feature", () => {
    expect(() => requireFeature("mantle", "zaas")).toThrow(EchoError);
    expect(() => requireFeature("megaeth", "zaas")).toThrow(EchoError);
  });
});

describe("formatUsd", () => {
  it("formats number", () => {
    expect(formatUsd(1234.5)).toContain("1,234.50");
  });

  it("formats string number", () => {
    expect(formatUsd("0.5")).toContain("0.50");
  });

  it("returns placeholder for NaN", () => {
    expect(formatUsd("not a number")).toBe("$—");
    expect(formatUsd(NaN)).toBe("$—");
  });
});

describe("formatGas", () => {
  it("combines gas and USD", () => {
    const result = formatGas("150000", "7.50");
    expect(result).toContain("150000");
    expect(result).toContain("7.50");
  });
});

// ── Token resolution (address path + symbol fallback) ──────────────

describe("resolveTokenMetadata — address path", () => {
  it("reads ERC-20 metadata on-chain for address input", async () => {
    const { resolveTokenMetadata } = await import("@commands/kyberswap/helpers.js");
    const result = await resolveTokenMetadata("0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed", 137);
    expect(result.address).toBe("0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed");
    expect(result.symbol).toBe("axlUSDC");
    expect(result.decimals).toBe(6);
    expect(result.isNative).toBe(false);
  });

  it("returns native metadata for 'native' input", async () => {
    const { resolveTokenMetadata } = await import("@commands/kyberswap/helpers.js");
    const result = await resolveTokenMetadata("native", 137);
    expect(result.isNative).toBe(true);
    expect(result.decimals).toBe(18);
  });
});

describe("resolveTokenMetadata — symbol path with fallback", () => {
  it("resolves USDC via whitelisted search (no fallback needed)", async () => {
    const { resolveTokenMetadata } = await import("@commands/kyberswap/helpers.js");
    const result = await resolveTokenMetadata("USDC", 137);
    expect(result.symbol).toBe("USDC");
    expect(result.decimals).toBe(6);
  });

  it("resolves axlUSDC via fallback (whitelisted returns 0, broader finds it)", async () => {
    const { resolveTokenMetadata } = await import("@commands/kyberswap/helpers.js");
    const result = await resolveTokenMetadata("axlUSDC", 137);
    expect(result.symbol).toBe("axlUSDC");
    expect(result.address).toBe("0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed");
  });

  it("throws for completely unknown symbol", async () => {
    const { resolveTokenMetadata } = await import("@commands/kyberswap/helpers.js");
    await expect(resolveTokenMetadata("NONEXISTENT_TOKEN_XYZ", 137)).rejects.toThrow();
  });
});

describe("resolveTokenAddress — symbol fallback", () => {
  it("resolves address for whitelisted symbol", async () => {
    const { resolveTokenAddress } = await import("@commands/kyberswap/helpers.js");
    const result = await resolveTokenAddress("USDC", 137);
    expect(result).toBe("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359");
  });

  it("resolves address for non-whitelisted symbol via fallback", async () => {
    const { resolveTokenAddress } = await import("@commands/kyberswap/helpers.js");
    const result = await resolveTokenAddress("axlUSDC", 137);
    expect(result).toBe("0x750e4C4984a9e0f12978eA6742Bc1c5D248f40ed");
  });
});
