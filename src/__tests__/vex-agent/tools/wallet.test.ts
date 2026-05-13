import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock wallet dependencies — no real keystore/config in test env
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

vi.mock("viem", () => ({
  getAddress: (address: string) => address,
  parseUnits: (value: string, decimals: number) => {
    const [rawWhole, rawFraction = ""] = value.split(".");
    const negative = rawWhole.startsWith("-");
    const whole = negative ? rawWhole.slice(1) : rawWhole;
    const fraction = rawFraction.padEnd(decimals, "0").slice(0, decimals);
    const digits = `${whole || "0"}${fraction}`.replace(/^0+(?=\d)/, "");
    const amount = BigInt(digits || "0");
    return negative ? -amount : amount;
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

const mockResolveChainId = vi.fn().mockReturnValue(1);
const mockGetChain = vi.fn().mockReturnValue(MOCK_CHAIN);

vi.mock("@tools/khalani/chains.js", () => ({
  resolveChainId: (...args: unknown[]) => mockResolveChainId(...args),
  getChain: (...args: unknown[]) => mockGetChain(...args),
  getCachedKhalaniChains: async () => [MOCK_CHAIN, MOCK_SOLANA_CHAIN],
}));

const mockSendTransaction = vi.fn().mockResolvedValue("0xmockhash" as `0x${string}`);
const mockWriteContract = vi.fn().mockResolvedValue("0xmockhash" as `0x${string}`);
const mockReadContract = vi.fn().mockResolvedValue(18);
const mockWaitForReceipt = vi.fn().mockResolvedValue({ status: "success", blockNumber: 123n });

vi.mock("@tools/khalani/evm-client.js", () => ({
  createDynamicPublicClient: () => ({
    waitForTransactionReceipt: (...args: unknown[]) => mockWaitForReceipt(...args),
    readContract: (...args: unknown[]) => mockReadContract(...args),
  }),
  createDynamicWalletClient: () => ({
    sendTransaction: (...args: unknown[]) => mockSendTransaction(...args),
    writeContract: (...args: unknown[]) => mockWriteContract(...args),
    account: { address: "0x1234567890abcdef1234567890abcdef12345678" },
  }),
}));

// Keep old mocks for backward compat (unused after rewrite but safe to have)
vi.mock("@tools/wallet/client.js", () => ({
  getPublicClient: () => ({ waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 123n }) }),
}));

vi.mock("@tools/wallet/signingClient.js", () => ({
  getSigningClient: () => ({ sendTransaction: async () => "0xmockhash" }),
}));

vi.mock("@tools/solana-ecosystem/shared/solana-transfer.js", () => ({
  sendSol: async () => ({ signature: "mocksig123", explorerUrl: "https://explorer.solana.com/tx/mocksig123" }),
  sendSplToken: async () => ({ signature: "mocksplsig456", explorerUrl: "https://explorer.solana.com/tx/mocksplsig456" }),
}));

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js", () => ({
  resolveJupiterToken: async (sym: string) => {
    if (sym === "USDC") return { chain: "solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6 };
    return undefined;
  },
}));

vi.mock("@solana/web3.js", async () => {
  const actual = await vi.importActual<typeof import("@solana/web3.js")>("@solana/web3.js");
  return { ...actual, Keypair: { fromSecretKey: () => ({ publicKey: { toBase58: () => "9WzDXwBbmkg" } }) } };
});

const { handleWalletRead, handleWalletSendPrepare, handleWalletSendConfirm } = await import(
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

describe("wallet_send_prepare", () => {
  it("creates a transfer intent for Solana native", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.5" },
      baseContext,
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.intentId).toMatch(/^intent-/);
    expect(data.network).toBe("solana");
    expect(data.amount).toBe("1.5");
    expect(data.token).toBe("native");
    expect(data.status).toBe("prepared");
  });

  it("creates a transfer intent for EVM", async () => {
    const result = await handleWalletSendPrepare(
      { network: "eip155", chain: "ethereum", to: "0x1234567890abcdef1234567890abcdef12345678", amount: "0.5" },
      baseContext,
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.network).toBe("eip155");
  });

  it("fails for EVM without chain", async () => {
    const result = await handleWalletSendPrepare(
      { network: "eip155", to: "0x1234567890abcdef1234567890abcdef12345678", amount: "0.5" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("chain for eip155");
  });

  it("creates intent with SPL token", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "100", token: "USDC" },
      baseContext,
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.token).toBe("USDC");
  });

  it("fails without network", async () => {
    const result = await handleWalletSendPrepare(
      { to: "0x123", amount: "1" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("fails without to", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", amount: "1" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("fails without amount", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("fails on invalid amount", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg", amount: "abc" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid amount");
  });

  it("fails on zero amount", async () => {
    const result = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg", amount: "0" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid amount");
  });

  it("fails on invalid network", async () => {
    const result = await handleWalletSendPrepare(
      { network: "bitcoin", to: "abc", amount: "1" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("network must be");
  });
});

describe("wallet_send_confirm", () => {
  it("fails without intentId", async () => {
    const result = await handleWalletSendConfirm(
      { network: "solana" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("fails on unknown intentId", async () => {
    const result = await handleWalletSendConfirm(
      { network: "solana", intentId: "intent-nonexistent" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Intent not found");
  });

  it("executes Solana native transfer after prepare", async () => {
    // Prepare
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.0" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    // Confirm
    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.signature).toBe("mocksig123");
  });

  it("executes Solana SPL token transfer after prepare", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "50", token: "USDC" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.signature).toBe("mocksplsig456");
  });

  it("executes EVM native transfer after prepare", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "eip155", chain: "ethereum", to: "0x1234567890abcdef1234567890abcdef12345678", amount: "0.1" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.txHash).toBe("0xmockhash");
  });

  it("intent is one-time use — second confirm fails", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.0" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    // First confirm
    await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );

    // Second confirm — should fail
    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Intent not found");
  });

  it("fails on network mismatch", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.0" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Network mismatch");
  });

  it("includes _tradeCapture in result data", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "1.0" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.data).toBeDefined();
    expect(result.data!._tradeCapture).toBeDefined();
    expect((result.data!._tradeCapture as Record<string, unknown>).type).toBe("transfer");
    expect((result.data!._tradeCapture as Record<string, unknown>).chain).toBe("solana");
  });

  it("fails on unknown token for SPL transfer", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "solana", to: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: "10", token: "NONEXISTENT" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "solana", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(false);
    // Without JUPITER_API_KEY, resolution fails with key error; with key, it fails with "Token not found"
    expect(result.output).toMatch(/Token not found|JUPITER_API_KEY/);
  });
});

describe("wallet_send_confirm — EVM branches", () => {
  beforeEach(() => {
    mockSendTransaction.mockClear();
    mockWriteContract.mockClear();
    mockReadContract.mockClear();
    mockResolveChainId.mockClear();
    mockGetChain.mockClear();
    mockWaitForReceipt.mockClear();
  });

  it("resolves non-default chain via resolveChainId", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "eip155", chain: "polygon", to: "0x1234567890abcdef1234567890abcdef12345678", amount: "0.1" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    await handleWalletSendConfirm(
      { network: "eip155", intentId },
      { ...baseContext, approved: true },
    );
    expect(mockResolveChainId).toHaveBeenCalledWith("polygon", expect.anything());
  });

  it("ERC-20 branch calls writeContract with transfer ABI", async () => {
    const tokenAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const prepResult = await handleWalletSendPrepare(
      { network: "eip155", chain: "ethereum", to: "0x1234567890abcdef1234567890abcdef12345678", amount: "100", token: tokenAddress },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(true);
    // Should read decimals first
    expect(mockReadContract).toHaveBeenCalledTimes(1);
    // Should call writeContract (not sendTransaction) for ERC-20
    expect(mockWriteContract).toHaveBeenCalledTimes(1);
    expect(mockSendTransaction).not.toHaveBeenCalled();
    // Verify ABI contains "transfer" functionName
    const writeArgs = mockWriteContract.mock.calls[0][0];
    expect(writeArgs.functionName).toBe("transfer");
    // _tradeCapture type is "transfer" for ERC-20
    expect((result.data!._tradeCapture as Record<string, unknown>).type).toBe("transfer");
  });

  it("ERC-721 branch calls writeContract with safeTransferFrom ABI", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "eip155", chain: "ethereum", to: "0x1234567890abcdef1234567890abcdef12345678", amount: "1", token: "nft:0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D:42" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(true);
    // Should call writeContract (not sendTransaction) for ERC-721
    expect(mockWriteContract).toHaveBeenCalledTimes(1);
    expect(mockSendTransaction).not.toHaveBeenCalled();
    // Verify ABI contains "safeTransferFrom" and tokenId
    const writeArgs = mockWriteContract.mock.calls[0][0];
    expect(writeArgs.functionName).toBe("safeTransferFrom");
    expect(writeArgs.args[2]).toBe(42n);
    // _tradeCapture type is "send" for ERC-721
    expect((result.data!._tradeCapture as Record<string, unknown>).type).toBe("send");
  });

  it("native branch calls sendTransaction (not writeContract)", async () => {
    const prepResult = await handleWalletSendPrepare(
      { network: "eip155", chain: "ethereum", to: "0x1234567890abcdef1234567890abcdef12345678", amount: "0.5" },
      baseContext,
    );
    const intentId = JSON.parse(prepResult.output).intentId;

    const result = await handleWalletSendConfirm(
      { network: "eip155", intentId },
      { ...baseContext, approved: true },
    );
    expect(result.success).toBe(true);
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect((result.data!._tradeCapture as Record<string, unknown>).type).toBe("transfer");
    expect((result.data!._tradeCapture as Record<string, unknown>).chain).toBeTruthy();
  });
});
