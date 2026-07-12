import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, type Address } from "viem";

import { UNISWAP_V2_ROUTER_ABI } from "@tools/uniswap/abis.js";
import { resolveUniswapDeployment } from "@tools/uniswap/chains.js";
import { buildV2SwapTx } from "@tools/uniswap/execute.js";
import type { UniswapDeployment } from "@tools/uniswap/deployments.js";
import type { UniswapRoute } from "@tools/uniswap/types.js";

const TOKEN = getAddress("0xc7c9341765C3bEebf0Ea2aB05e69b68991A9A470");
const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const TOKEN_OUT = getAddress("0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31");
const RECIPIENT = getAddress("0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f");
const AMOUNT_IN = 100n;
const MIN_AMOUNT_OUT = 90n;
const DEADLINE = 1_900_000_000n;

function deployment(): UniswapDeployment {
  const resolved = resolveUniswapDeployment("robinhood");
  if (!resolved?.v2) throw new Error("Robinhood Chain V2 deployment is required for calldata tests.");
  return resolved;
}

function route(path: Address[]): UniswapRoute {
  return { version: "v2", path, amountOut: 100n };
}

describe("buildV2SwapTx fee-on-transfer-safe sells", () => {
  it("encodes the supporting token→ETH function with ordered Router02 arguments", () => {
    const tx = buildV2SwapTx({
      deployment: deployment(),
      route: route([TOKEN, WETH]),
      amountIn: AMOUNT_IN,
      minAmountOut: MIN_AMOUNT_OUT,
      recipient: RECIPIENT,
      deadline: DEADLINE,
      tokenInIsNative: false,
      tokenOutIsNative: true,
    });

    const decoded = decodeFunctionData({ abi: UNISWAP_V2_ROUTER_ABI, data: tx.data });
    expect(decoded.functionName).toBe("swapExactTokensForETHSupportingFeeOnTransferTokens");
    expect(decoded.args).toEqual([AMOUNT_IN, MIN_AMOUNT_OUT, [TOKEN, WETH], RECIPIENT, DEADLINE]);
    expect(tx.value).toBe(0n);
  });

  it("encodes the supporting token→token function with ordered Router02 arguments", () => {
    const tx = buildV2SwapTx({
      deployment: deployment(),
      route: route([TOKEN, WETH, TOKEN_OUT]),
      amountIn: AMOUNT_IN,
      minAmountOut: MIN_AMOUNT_OUT,
      recipient: RECIPIENT,
      deadline: DEADLINE,
      tokenInIsNative: false,
      tokenOutIsNative: false,
    });

    const decoded = decodeFunctionData({ abi: UNISWAP_V2_ROUTER_ABI, data: tx.data });
    expect(decoded.functionName).toBe("swapExactTokensForTokensSupportingFeeOnTransferTokens");
    expect(decoded.args).toEqual([AMOUNT_IN, MIN_AMOUNT_OUT, [TOKEN, WETH, TOKEN_OUT], RECIPIENT, DEADLINE]);
    expect(tx.value).toBe(0n);
  });

  it("keeps native-input buys on swapExactETHForTokens with msg.value", () => {
    const tx = buildV2SwapTx({
      deployment: deployment(),
      route: route([WETH, TOKEN]),
      amountIn: AMOUNT_IN,
      minAmountOut: MIN_AMOUNT_OUT,
      recipient: RECIPIENT,
      deadline: DEADLINE,
      tokenInIsNative: true,
      tokenOutIsNative: false,
    });

    expect(decodeFunctionData({ abi: UNISWAP_V2_ROUTER_ABI, data: tx.data }).functionName).toBe("swapExactETHForTokens");
    expect(tx.value).toBe(AMOUNT_IN);
  });
});
