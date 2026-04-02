/**
 * evm_read internal tool tests — action dispatch, input validation, mock reads.
 */

import { describe, it, expect, vi } from "vitest";

// Mock khalani chain resolution
const MOCK_CHAIN = {
  id: 137, name: "Polygon", type: "eip155" as const,
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: ["https://polygon-rpc.example.com"] } },
};

vi.mock("@tools/khalani/client.js", () => ({
  getKhalaniClient: () => ({
    getChains: vi.fn().mockResolvedValue([MOCK_CHAIN]),
  }),
}));

vi.mock("@tools/khalani/chains.js", () => ({
  resolveChainId: vi.fn().mockReturnValue(137),
  getChain: vi.fn().mockReturnValue(MOCK_CHAIN),
}));

const mockGetTransactionReceipt = vi.fn();
const mockReadContract = vi.fn();
const mockGetBalance = vi.fn();

vi.mock("@tools/khalani/evm-client.js", () => ({
  createDynamicPublicClient: () => ({
    getTransactionReceipt: mockGetTransactionReceipt,
    readContract: mockReadContract,
    getBalance: mockGetBalance,
  }),
}));

vi.mock("@tools/kyberswap/evm-utils.js", () => ({
  extractMintedNftId: vi.fn().mockReturnValue("2879807"),
}));

const { handleEvmRead } = await import("../../../../echo-agent/tools/internal/evm-read.js");

const ctx = { sessionId: "test", loadedDocuments: new Map(), loopMode: "off" as const, approved: false, role: "parent" as const, missionRunId: null };

describe("evm_read", () => {
  it("rejects missing action", async () => {
    const result = await handleEvmRead({ chainId: "137" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: action");
  });

  it("rejects missing chainId", async () => {
    const result = await handleEvmRead({ action: "balance" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: chainId");
  });

  it("rejects unknown action", async () => {
    const result = await handleEvmRead({ action: "hack_contract", chainId: "137" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown action");
  });
});

describe("evm_read — tx_receipt", () => {
  it("returns receipt data", async () => {
    mockGetTransactionReceipt.mockResolvedValue({
      status: "success", blockNumber: 12345678n, gasUsed: 150000n,
      logs: [{ address: "0x1", topics: [], data: "0x" }],
      from: "0xabc", to: "0xdef", contractAddress: null,
    });
    const result = await handleEvmRead({ action: "tx_receipt", chainId: "137", txHash: "0xabc123" }, ctx);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.status).toBe("success");
    expect(data.gasUsed).toBe("150000");
    expect(data.logsCount).toBe(1);
  });

  it("rejects missing txHash", async () => {
    const result = await handleEvmRead({ action: "tx_receipt", chainId: "137" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: txHash");
  });
});

describe("evm_read — erc721_mint", () => {
  it("extracts minted NFTs from receipt", async () => {
    const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const WALLET = "0x00000000000000000000000018b467cb28fc07ca6e17a964b3319051b3072b79";

    mockGetTransactionReceipt.mockResolvedValue({
      status: "success", blockNumber: 100n, gasUsed: 500000n,
      logs: [
        { address: "0xc36442b4a4522e871399cd717abdd847ab11fe88", topics: [TRANSFER, ZERO, WALLET, "0x00000000000000000000000000000000000000000000000000000000002bf43f"], data: "0x" },
      ],
      from: "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79", to: "0xrouter", contractAddress: null,
    });

    const result = await handleEvmRead({ action: "erc721_mint", chainId: "137", txHash: "0xabc", address: "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79" }, ctx);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.mintsFound).toBe(1);
    expect(data.mints[0].tokenId).toBe("2880575");
    expect(data.mints[0].contract).toBe("0xc36442b4a4522e871399cd717abdd847ab11fe88");
  });
});

describe("evm_read — erc20_metadata", () => {
  it("reads decimals, symbol, name", async () => {
    mockReadContract
      .mockResolvedValueOnce(6) // decimals
      .mockResolvedValueOnce("USDC") // symbol
      .mockResolvedValueOnce("USD Coin"); // name

    const result = await handleEvmRead({ action: "erc20_metadata", chainId: "137", address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" }, ctx);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.decimals).toBe(6);
    expect(data.symbol).toBe("USDC");
  });

  it("rejects missing address", async () => {
    const result = await handleEvmRead({ action: "erc20_metadata", chainId: "137" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: address");
  });
});

describe("evm_read — balance", () => {
  it("returns native balance", async () => {
    mockGetBalance.mockResolvedValue(55000000000000000000n); // 55 POL

    const result = await handleEvmRead({ action: "balance", chainId: "137", address: "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79" }, ctx);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output);
    expect(data.balanceWei).toBe("55000000000000000000");
    expect(data.nativeCurrency).toBe("POL");
  });
});
