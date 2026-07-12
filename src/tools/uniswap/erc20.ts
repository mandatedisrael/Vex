/**
 * Uniswap ERC-20 helpers — metadata reads + EXACT-amount allowance to an
 * ALLOWLISTED router only.
 *
 * Approvals target ONLY a router in `UNISWAP_KNOWN_SPENDERS` (built from the
 * verified deployment registry). Per Wave-2c doctrine the approval is for the
 * EXACT input amount (not maxUint256) — a smaller standing allowance surface.
 */

import {
  getAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  type Account,
} from "viem";

import { VexError, ErrorCodes } from "../../errors.js";
import logger from "../../utils/logger.js";
import { waitForSuccessfulReceipt } from "@tools/evm-chains/receipt-guard.js";
import { UNISWAP_ERC20_ABI } from "./abis.js";
import { UNISWAP_KNOWN_SPENDERS } from "./deployments.js";

export interface UniswapErc20Metadata {
  address: Address;
  symbol: string;
  decimals: number;
  isNative: false;
}

/** Read ERC-20 metadata directly from chain. decimals mandatory; symbol tolerant. */
export async function readUniswapErc20Metadata(
  client: PublicClient<Transport, Chain>,
  address: Address,
): Promise<UniswapErc20Metadata> {
  let decimals: number;
  try {
    decimals = await client.readContract({ address, abi: UNISWAP_ERC20_ABI, functionName: "decimals" });
  } catch {
    throw new VexError(
      ErrorCodes.KYBER_TOKEN_NOT_FOUND,
      `Cannot read decimals for ${address} — not a valid ERC-20 contract on this chain`,
      "Verify the token address and chain are correct.",
    );
  }
  let symbol = "UNKNOWN";
  try {
    symbol = await client.readContract({ address, abi: UNISWAP_ERC20_ABI, functionName: "symbol" });
  } catch {
    logger.debug({ event: "uniswap.erc20.symbol_failed", address });
  }
  return { address, symbol, decimals, isNative: false };
}

/** Verify a spender is an allowlisted Uniswap router. Throws otherwise. */
export function validateUniswapSpender(address: Address): void {
  if (!UNISWAP_KNOWN_SPENDERS.has(address.toLowerCase())) {
    throw new VexError(
      ErrorCodes.INVALID_SPENDER,
      `Spender ${address} is not a known Uniswap router`,
      "Approvals may only target a registered Uniswap V2 Router02 or V3 SwapRouter02.",
    );
  }
}

/**
 * Ensure the router has at least `requiredAmount` allowance for `token`.
 * Approves the EXACT `requiredAmount` when short. Handles USDT-style tokens that
 * require a reset to 0 before a new non-zero approval. Returns the approval tx
 * hash (and any reset tx), or null when the allowance was already sufficient.
 */
export async function ensureUniswapAllowanceExact(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain, Account>,
  token: Address,
  spender: Address,
  requiredAmount: bigint,
): Promise<{ txHash: Hex; resetTxHash?: Hex } | null> {
  validateUniswapSpender(spender);
  const owner = walletClient.account.address;

  const currentAllowance = (await publicClient.readContract({
    address: token,
    abi: UNISWAP_ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;

  if (currentAllowance >= requiredAmount) {
    logger.debug({ event: "uniswap.allowance.sufficient", token, spender });
    return null;
  }

  let resetTxHash: Hex | undefined;
  if (currentAllowance > 0n) {
    try {
      resetTxHash = await walletClient.writeContract({
        account: walletClient.account,
        chain: walletClient.chain,
        address: token,
        abi: UNISWAP_ERC20_ABI,
        functionName: "approve",
        args: [spender, 0n],
      });
      await waitForSuccessfulReceipt(publicClient, resetTxHash, {
        code: ErrorCodes.APPROVAL_FAILED,
        what: "Allowance-reset transaction",
        hint: "The existing allowance was not cleared, so the follow-up approve would be blocked. Check the transaction hash before retrying.",
      });
    } catch (err) {
      if (err instanceof VexError) throw err;
      throw new VexError(ErrorCodes.APPROVAL_FAILED, `Failed to reset allowance: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const txHash = await walletClient.writeContract({
      account: walletClient.account,
      chain: walletClient.chain,
      address: getAddress(token),
      abi: UNISWAP_ERC20_ABI,
      functionName: "approve",
      args: [spender, requiredAmount],
    });
    await waitForSuccessfulReceipt(publicClient, txHash, {
      code: ErrorCodes.APPROVAL_FAILED,
      what: "Approval transaction",
      hint: "The router was not granted an allowance. Check the transaction hash before retrying.",
    });
    return resetTxHash ? { txHash, resetTxHash } : { txHash };
  } catch (err) {
    if (err instanceof VexError) throw err;
    throw new VexError(ErrorCodes.APPROVAL_FAILED, `Failed to approve: ${err instanceof Error ? err.message : String(err)}`);
  }
}
