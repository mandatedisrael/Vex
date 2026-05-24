/**
 * wallet_read tests.
 *
 * Puzzle 5 phase 4: `wallet_send_prepare` / `wallet_send_confirm` are
 * covered by `src/__tests__/vex-agent/tools/internal/wallet/send.test.ts`
 * (orchestrator + ExecuteOutcome paths) +
 * `src/__tests__/vex-agent/db/repos/wallet-intents.test.ts` (repo CAS
 * shapes). Send tests cannot run from this file anymore because the
 * Map-based intent store was replaced by the DB-backed `wallet_intents`
 * table; the comprehensive coverage now mocks `walletIntentsRepo` +
 * executor modules directly.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@tools/wallet/multi-auth.js", () => ({
  requireEvmWallet: () => ({ family: "eip155", address: "0x1234567890abcdef1234567890abcdef12345678", privateKey: "0x" + "ab".repeat(32) }),
  requireSolanaWallet: () => ({ family: "solana", address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", secretKey: new Uint8Array(64) }),
}));

vi.mock("@tools/wallet/family.js", () => ({
  normalizeWalletChain: (input?: string) => {
    if (!input || input === "eip155" || input === "evm") return "eip155";
    if (input === "solana" || input === "sol") return "solana";
    throw new Error(`Unsupported wallet chain: ${input}`);
  },
}));

const MOCK_CHAIN = {
  id: 1, name: "Ethereum", type: "eip155" as const,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://ethereum.example.com"] } },
};
const MOCK_SOLANA_CHAIN = {
  id: 20011000000, name: "Solana", type: "solana" as const,
  nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  rpcUrls: { default: { http: ["https://api.mainnet-beta.solana.com"] } },
};

vi.mock("@tools/khalani/client.js", () => ({
  getKhalaniClient: () => ({
    getTokenBalances: async (_address: string, chainIds?: number[]) => {
      const chainId = chainIds?.[0] ?? 1;
      if (chainId === 20011000000) {
        return [
          { address: "So11111111111111111111111111111111111111112", chainId, symbol: "SOL", name: "Solana", decimals: 9, extensions: { balance: "2000000000", price: { usd: "100.00" } } },
        ];
      }
      return [
        { address: "native", chainId, symbol: "ETH", name: "Ether", decimals: 18, extensions: { balance: "5000000000000000000", price: { usd: "3000.00" } } },
        { address: "0xUSDC", chainId, symbol: "USDC", name: "USD Coin", decimals: 6, extensions: { balance: "100000000", price: { usd: "1.00" } } },
      ];
    },
    getChains: async () => [MOCK_CHAIN, MOCK_SOLANA_CHAIN],
  }),
}));

vi.mock("@tools/khalani/chains.js", () => ({
  resolveChainId: () => 1,
  getChain: () => MOCK_CHAIN,
  getCachedKhalaniChains: async () => [MOCK_CHAIN, MOCK_SOLANA_CHAIN],
}));

const { handleWalletRead } = await import(
  "../../../vex-agent/tools/internal/wallet.js"
);
import { makeTestContext } from "./_test-context.js";

const baseContext = makeTestContext();

describe("wallet_read", () => {
  // ── live snapshots ─────────────────────────────────────────────

  it("returns live snapshots for all configured wallets by default", async () => {
    const result = await handleWalletRead({}, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.wallet).toBe("all");
    expect(data.wallets).toHaveLength(2);
    expect(data.wallets.map((wallet: { wallet: string }) => wallet.wallet)).toEqual(["eip155", "solana"]);
    expect(data.totalUsd).toBeGreaterThan(0);
  });

  // Empty/whitespace `chainIds` is normalized to "scan all chains". MCP-style
  // serializers and many LLM providers emit `""` for "no value" — the handler
  // must treat that as omission, not a validation error.
  it("treats empty chainIds string as omission (scans all chains)", async () => {
    const omitted = await handleWalletRead({ wallet: "all" }, baseContext);
    const empty = await handleWalletRead({ wallet: "all", chainIds: "" }, baseContext);
    expect(empty.success).toBe(true);
    expect(omitted.success).toBe(true);
    const omittedData = JSON.parse(omitted.output);
    const emptyData = JSON.parse(empty.output);
    expect(emptyData.wallets).toHaveLength(omittedData.wallets.length);
    expect(emptyData.wallets.map((w: { wallet: string }) => w.wallet)).toEqual(
      omittedData.wallets.map((w: { wallet: string }) => w.wallet),
    );
  });

  it("treats whitespace-only chainIds as omission", async () => {
    const result = await handleWalletRead({ wallet: "all", chainIds: "   " }, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.wallets).toHaveLength(2);
  });

  it("returns EVM snapshot when wallet=eip155", async () => {
    const result = await handleWalletRead({ wallet: "eip155" }, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.wallets).toHaveLength(1);
    expect(data.wallets[0].wallet).toBe("eip155");
    expect(data.wallets[0].address).toMatch(/^0x/);
    expect(data.wallets[0].tokens.length).toBeGreaterThan(0);
  });

  it("returns Solana snapshot when wallet=solana", async () => {
    const result = await handleWalletRead({ wallet: "solana" }, baseContext);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.wallets).toHaveLength(1);
    expect(data.wallets[0].wallet).toBe("solana");
    expect(data.wallets[0].address).toBeTruthy();
  });

  it("snapshot includes token data with prices", async () => {
    const result = await handleWalletRead({ wallet: "eip155" }, baseContext);
    const data = JSON.parse(result.output);
    const tokens = data.wallets[0].tokens;
    expect(tokens.map((token: { symbol: string }) => token.symbol)).toContain("ETH");
    const eth = tokens.find((token: {
      symbol: string;
      extensions?: { price?: { usd?: string } };
    }) => token.symbol === "ETH");
    expect(eth?.extensions?.price?.usd).toBe("3000.00");
  });

  // ── errors ─────────────────────────────────────────────────────

  it("fails on invalid wallet parameter", async () => {
    const result = await handleWalletRead({ wallet: "bitcoin" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("wallet_read");
  });
});
