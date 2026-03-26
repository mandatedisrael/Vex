import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseUnits } from "viem";

const mockGetRoute = vi.fn();
const mockWriteJsonSuccess = vi.fn();
const mockResolveTokenMetadata = vi.fn();

vi.mock("../tools/kyberswap/aggregator/client.js", () => ({
  getKyberAggregatorClient: () => ({
    getRoute: mockGetRoute,
    buildRoute: vi.fn(),
  }),
}));

vi.mock("../tools/kyberswap/constants.js", () => ({
  META_AGGREGATION_ROUTER_V2: "0xrouter",
  NATIVE_TOKEN_ADDRESS: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
}));

vi.mock("../tools/kyberswap/evm-utils.js", () => ({
  getKyberEvmClients: vi.fn(),
  ensureKyberAllowance: vi.fn(),
  verifyRouterAddress: vi.fn(),
  sendKyberTransaction: vi.fn(),
}));

vi.mock("../tools/kyberswap/chains.js", () => ({
  slugToChainId: () => 1,
}));

vi.mock("../tools/wallet/auth.js", () => ({
  requireWalletAndKeystore: vi.fn(),
}));

vi.mock("../commands/kyberswap/helpers.js", () => ({
  resolveChain: () => "ethereum",
  resolveTokenMetadata: (...args: unknown[]) => mockResolveTokenMetadata(...args),
  formatUsd: (value: string | number) => `$${value}`,
  formatGas: (gas: string, gasUsd: string) => `${gas} gas (~$${gasUsd})`,
  requireFeature: vi.fn(),
}));

vi.mock("../utils/validation.js", () => ({
  parseIntSafe: (value: string) => Number.parseInt(value, 10),
  validateSlippage: (value: number) => value,
}));

vi.mock("../utils/output.js", () => ({
  isHeadless: () => true,
  writeJsonSuccess: (...args: unknown[]) => mockWriteJsonSuccess(...args),
}));

vi.mock("../utils/ui.js", () => ({
  spinner: () => ({
    text: "",
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
  successBox: vi.fn(),
  infoBox: vi.fn(),
  colors: {
    value: (value: string) => value,
    info: (value: string) => value,
  },
}));

const { createSwapSubcommand } = await import("../commands/kyberswap/swap.js");

function getSwapCommand() {
  const command = createSwapSubcommand();
  command.exitOverride();
  return command;
}

describe("kyberswap swap decimals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTokenMetadata.mockImplementation(async (input: string) => {
      if (input.toLowerCase() === "usdc") {
        return {
          address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
          isNative: false,
        };
      }
      if (input.toLowerCase() === "weth") {
        return {
          address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
          symbol: "WETH",
          name: "Wrapped Ether",
          decimals: 18,
          isNative: false,
        };
      }
      throw new Error(`Unexpected token ${input}`);
    });
    mockGetRoute.mockResolvedValue({
      data: {
        routeSummary: {
          amountIn: "1230000",
          amountOut: "500000000000000000",
          amountInUsd: "1.23",
          amountOutUsd: "1.24",
          gas: "210000",
          gasUsd: "3.50",
          route: [[{ exchange: "UniswapV3" }]],
          routeID: "route-1",
        },
        routerAddress: "0xrouter",
      },
    });
  });

  it("quotes using the input token decimals instead of hardcoded 18 decimals", async () => {
    const quote = getSwapCommand();

    await quote.parseAsync(
      ["quote", "USDC", "WETH", "--chain", "eth", "--amount-in", "1.23"],
      { from: "user" },
    );

    expect(mockGetRoute).toHaveBeenCalledWith("ethereum", expect.objectContaining({
      amountIn: parseUnits("1.23", 6).toString(),
    }));

    expect(mockWriteJsonSuccess).toHaveBeenCalledWith(expect.objectContaining({
      amountIn: "1230000",
      amountInNormalized: "1.23",
      amountOutNormalized: "0.5",
      tokenInDecimals: 6,
      tokenOutDecimals: 18,
    }));
  });

  it("returns normalized amounts for sell dry-runs", async () => {
    const sell = getSwapCommand();

    await sell.parseAsync(
      ["sell", "USDC", "WETH", "--chain", "eth", "--amount-in", "1.23", "--dry-run"],
      { from: "user" },
    );

    expect(mockWriteJsonSuccess).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true,
      requestedAmountIn: "1.23",
      amountInNormalized: "1.23",
      amountOutNormalized: "0.5",
      tokenInSymbol: "USDC",
      tokenOutSymbol: "WETH",
    }));
  });
});
