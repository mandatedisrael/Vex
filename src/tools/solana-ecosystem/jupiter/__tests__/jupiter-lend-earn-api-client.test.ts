import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchJson = vi.fn();
function callMock<T>(mock: unknown, args: unknown[]): T {
  return (mock as (...innerArgs: unknown[]) => T)(...args);
}
vi.mock("@utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => callMock(mockFetchJson, args),
}));

const {
  jupiterLendEarnTokens,
  jupiterLendEarnPositions,
  jupiterLendEarnEarnings,
  jupiterLendEarnDepositTransaction,
  jupiterLendEarnWithdrawTransaction,
  jupiterLendEarnMintTransaction,
  jupiterLendEarnRedeemTransaction,
  jupiterLendEarnDepositInstructions,
  jupiterLendEarnWithdrawInstructions,
  jupiterLendEarnMintInstructions,
  jupiterLendEarnRedeemInstructions,
} = await import("@tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/client.js");

const USER_1 = "GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ";
const USER_2 = "gasTzr94Pmp4Gf8vknQnqxeYxdgwFjbgdJa4msYRpnB";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

describe("jupiter lend earn api client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, JUPITER_API_KEY: "test-jupiter-key" };
  });

  it("calls read endpoints with normalized query params and x-api-key", async () => {
    mockFetchJson
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await jupiterLendEarnTokens();
    await jupiterLendEarnPositions({ users: [USER_1, USER_2] });
    await jupiterLendEarnEarnings({ user: USER_1, positions: [USDC, WSOL] });

    const [tokensUrl, tokensOpts] = mockFetchJson.mock.calls[0];
    expect(tokensUrl).toBe("https://api.jup.ag/lend/v1/earn/tokens");
    expect(tokensOpts.headers).toEqual({ "x-api-key": "test-jupiter-key" });

    const [positionsUrl, positionsOpts] = mockFetchJson.mock.calls[1];
    expect(positionsUrl).toBe(
      "https://api.jup.ag/lend/v1/earn/positions?users=GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ%2CgasTzr94Pmp4Gf8vknQnqxeYxdgwFjbgdJa4msYRpnB",
    );
    expect(positionsOpts.headers).toEqual({ "x-api-key": "test-jupiter-key" });

    const [earningsUrl, earningsOpts] = mockFetchJson.mock.calls[2];
    expect(earningsUrl).toBe(
      "https://api.jup.ag/lend/v1/earn/earnings?user=GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ&positions=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v%2CSo11111111111111111111111111111111111111112",
    );
    expect(earningsOpts.headers).toEqual({ "x-api-key": "test-jupiter-key" });
  });

  it("calls all transaction endpoints with POST json bodies", async () => {
    mockFetchJson
      .mockResolvedValueOnce({ transaction: "dep-base64" })
      .mockResolvedValueOnce({ transaction: "wd-base64" })
      .mockResolvedValueOnce({ transaction: "mint-base64" })
      .mockResolvedValueOnce({ transaction: "redeem-base64" });

    await jupiterLendEarnDepositTransaction({ asset: USDC, signer: USER_1, amount: "1000000" });
    await jupiterLendEarnWithdrawTransaction({ asset: USDC, signer: USER_1, amount: "500000" });
    await jupiterLendEarnMintTransaction({ asset: USDC, signer: USER_1, shares: "1000000" });
    await jupiterLendEarnRedeemTransaction({ asset: USDC, signer: USER_1, shares: "500000" });

    const [depositUrl, depositOpts] = mockFetchJson.mock.calls[0];
    expect(depositUrl).toBe("https://api.jup.ag/lend/v1/earn/deposit");
    expect(depositOpts.method).toBe("POST");
    expect(depositOpts.headers).toEqual({
      "x-api-key": "test-jupiter-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(depositOpts.body)).toEqual({
      asset: USDC,
      signer: USER_1,
      amount: "1000000",
    });

    const [withdrawUrl, withdrawOpts] = mockFetchJson.mock.calls[1];
    expect(withdrawUrl).toBe("https://api.jup.ag/lend/v1/earn/withdraw");
    expect(JSON.parse(withdrawOpts.body)).toEqual({
      asset: USDC,
      signer: USER_1,
      amount: "500000",
    });

    const [mintUrl, mintOpts] = mockFetchJson.mock.calls[2];
    expect(mintUrl).toBe("https://api.jup.ag/lend/v1/earn/mint");
    expect(JSON.parse(mintOpts.body)).toEqual({
      asset: USDC,
      signer: USER_1,
      shares: "1000000",
    });

    const [redeemUrl, redeemOpts] = mockFetchJson.mock.calls[3];
    expect(redeemUrl).toBe("https://api.jup.ag/lend/v1/earn/redeem");
    expect(JSON.parse(redeemOpts.body)).toEqual({
      asset: USDC,
      signer: USER_1,
      shares: "500000",
    });
  });

  it("calls all instruction endpoints with POST json bodies", async () => {
    const instruction = { programId: "prog", accounts: [], data: "base64" };
    mockFetchJson
      .mockResolvedValueOnce(instruction)
      .mockResolvedValueOnce(instruction)
      .mockResolvedValueOnce(instruction)
      .mockResolvedValueOnce(instruction);

    await jupiterLendEarnDepositInstructions({ asset: USDC, signer: USER_1, amount: "1000000" });
    await jupiterLendEarnWithdrawInstructions({ asset: USDC, signer: USER_1, amount: "500000" });
    await jupiterLendEarnMintInstructions({ asset: USDC, signer: USER_1, shares: "1000000" });
    await jupiterLendEarnRedeemInstructions({ asset: USDC, signer: USER_1, shares: "500000" });

    const [depositUrl, depositOpts] = mockFetchJson.mock.calls[0];
    expect(depositUrl).toBe("https://api.jup.ag/lend/v1/earn/deposit-instructions");
    expect(depositOpts.method).toBe("POST");
    expect(JSON.parse(depositOpts.body)).toEqual({
      asset: USDC,
      signer: USER_1,
      amount: "1000000",
    });

    const [withdrawUrl] = mockFetchJson.mock.calls[1];
    expect(withdrawUrl).toBe("https://api.jup.ag/lend/v1/earn/withdraw-instructions");

    const [mintUrl] = mockFetchJson.mock.calls[2];
    expect(mintUrl).toBe("https://api.jup.ag/lend/v1/earn/mint-instructions");

    const [redeemUrl] = mockFetchJson.mock.calls[3];
    expect(redeemUrl).toBe("https://api.jup.ag/lend/v1/earn/redeem-instructions");
  });

  it("rejects when JUPITER_API_KEY is missing", async () => {
    delete process.env.JUPITER_API_KEY;

    await expect(
      jupiterLendEarnTokens(),
    ).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED" });

    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it("rejects invalid addresses and empty lists before fetching", async () => {
    await expect(
      jupiterLendEarnPositions({ users: [] }),
    ).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED" });

    await expect(
      jupiterLendEarnDepositTransaction({ asset: "not-a-pubkey", signer: USER_1, amount: "1000" }),
    ).rejects.toMatchObject({ code: "SOLANA_INVALID_ADDRESS" });

    await expect(
      jupiterLendEarnMintTransaction({ asset: USDC, signer: USER_1, shares: "0" }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });

    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
