import { beforeEach, describe, expect, it, vi } from "vitest";
import { VexError, ErrorCodes } from "../../../errors.js";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

const TOKEN_IN = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b";
const TOKEN_OUT = "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31";
const WALLET = "0x1111111111111111111111111111111111111111";

const ensureErc20Balance = vi.fn();
const ensureUniswapAllowanceExact = vi.fn();
const sendUniswapTransaction = vi.fn();

vi.mock("@tools/uniswap/chains.js", () => ({
  resolveUniswapDeployment: vi.fn(() => ({
    key: "robinhood",
    name: "Robinhood Chain",
    chainId: 4663,
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    v2: { router02: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba" },
  })),
}));
vi.mock("@tools/uniswap/evm-client.js", () => ({
  getUniswapPublicClient: vi.fn(() => ({})),
  getUniswapEvmClients: vi.fn(() => ({ publicClient: {}, walletClient: {} })),
}));
vi.mock("@tools/uniswap/erc20.js", () => ({
  readUniswapErc20Metadata: vi.fn(async (_client: unknown, address: string) => ({
    address,
    symbol: "TKN",
    decimals: 18,
    isNative: false,
  })),
  ensureUniswapAllowanceExact: (...args: unknown[]) => ensureUniswapAllowanceExact(...args),
}));
vi.mock("@tools/evm-chains/erc20-balance-guard.js", () => ({
  ensureErc20Balance: (...args: unknown[]) => ensureErc20Balance(...args),
}));
vi.mock("@tools/uniswap/quote.js", () => ({
  quoteBestRoute: vi.fn(async () => ({ route: { version: "v2", path: [TOKEN_IN, TOKEN_OUT], amountOut: 10n } })),
  applySlippage: vi.fn((amount: bigint) => amount),
}));
vi.mock("@tools/uniswap/execute.js", () => ({
  NATIVE_TOKEN_ADDRESS: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  buildSwapTx: vi.fn(),
  sendUniswapTransaction: (...args: unknown[]) => sendUniswapTransaction(...args),
}));
vi.mock("@tools/uniswap/safety.js", () => ({ checkRouteFactories: vi.fn(), probeFotSignal: vi.fn(), UNISWAP_MIN_LIQUIDITY_USD: 5000 }));
vi.mock("@tools/dexscreener/client.js", () => ({ getDexScreenerClient: vi.fn() }));
vi.mock("@tools/evm-chains/registry.js", () => ({ getLocalChain: vi.fn() }));
vi.mock("@vex-agent/db/repos/tracked-tokens.js", () => ({ pinTrackedToken: vi.fn() }));
vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSigningWallet: vi.fn(() => ({ family: "eip155", address: WALLET, privateKey: `0x${"ab".repeat(32)}` })),
  walletScopeErrorToResult: vi.fn(),
}));
vi.mock("@utils/logger.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { UNISWAP_SWAP_HANDLERS } from "@vex-agent/tools/protocols/uniswap/handlers/swap.js";

const context = {
  sessionPermission: "full",
  approved: true,
  walletResolution: { source: "default" },
  walletPolicy: { kind: "none" },
} as unknown as ProtocolExecutionContext;

describe("Uniswap balance preflight", () => {
  beforeEach(() => {
    ensureUniswapAllowanceExact.mockReset();
    sendUniswapTransaction.mockReset();
    ensureErc20Balance.mockReset();
    ensureErc20Balance.mockRejectedValue(new VexError(ErrorCodes.INSUFFICIENT_BALANCE, "short balance"));
  });

  it("returns INSUFFICIENT_BALANCE without approving or broadcasting", async () => {
    await expect(
      UNISWAP_SWAP_HANDLERS["uniswap.swap.sell"]!(
        { chain: "robinhood", tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1" },
        context,
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.INSUFFICIENT_BALANCE });

    expect(ensureUniswapAllowanceExact).not.toHaveBeenCalled();
    expect(sendUniswapTransaction).not.toHaveBeenCalled();
  });
});
