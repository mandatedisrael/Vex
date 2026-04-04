/**
 * KyberSwap ERC-20 operations: metadata reads, spender validation,
 * allowance management, and transaction sending.
 */

import {
  getAddress,
  maxUint256,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Transport,
} from "viem";
import { EchoError, ErrorCodes } from "../../../errors.js";
import { KYBER_KNOWN_SPENDERS } from "../constants.js";
import logger from "../../../utils/logger.js";
import type { KyberChainSlug } from "../types.js";
import { ERC20_ABI, getKyberPublicClient } from "./config.js";

// ── On-chain ERC-20 metadata ────────────────────────────────────────

export interface Erc20Metadata {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  isNative: false;
}

/**
 * Read ERC-20 metadata directly from chain.
 *
 * Tolerant handling:
 * - decimals() — mandatory, throw if missing (not a valid ERC-20)
 * - symbol() — optional, some tokens return bytes32 or revert → "UNKNOWN"
 * - name() — optional, some tokens revert → "Unknown Token"
 */
export async function readErc20Metadata(slug: KyberChainSlug, address: Address): Promise<Erc20Metadata> {
  const client = getKyberPublicClient(slug);

  // decimals — mandatory
  let decimals: number;
  try {
    decimals = await client.readContract({
      address,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
  } catch (err) {
    throw new EchoError(
      ErrorCodes.KYBER_TOKEN_NOT_FOUND,
      `Cannot read decimals for ${address} on ${slug} — not a valid ERC-20 contract`,
      "Verify the token address and chain are correct.",
    );
  }

  // symbol — optional, tolerant
  let symbol = "UNKNOWN";
  try {
    symbol = await client.readContract({
      address,
      abi: ERC20_ABI,
      functionName: "symbol",
    });
  } catch {
    logger.debug({ event: "kyberswap.erc20.symbol_failed", address, slug });
  }

  // name — optional, tolerant
  let name = "Unknown Token";
  try {
    name = await client.readContract({
      address,
      abi: ERC20_ABI,
      functionName: "name",
    });
  } catch {
    logger.debug({ event: "kyberswap.erc20.name_failed", address, slug });
  }

  return { address, symbol, name, decimals, isNative: false as const };
}

// ── Spender validation ──────────────────────────────────────────────

/** Verify a spender address is in the KyberSwap known contracts allowlist. */
export function validateKyberSpender(address: Address): void {
  if (!KYBER_KNOWN_SPENDERS.has(address.toLowerCase())) {
    throw new EchoError(
      ErrorCodes.INVALID_SPENDER,
      `Spender ${address} is not a known KyberSwap contract`,
      `Known: MetaAggregationRouterV2, DSLOProtocol, KSZapRouterPosition, KSZapRouterPermit`,
    );
  }
}

/** Verify the router address from API response matches the expected constant. */
export function verifyRouterAddress(actual: Address, expected: Address): void {
  if (getAddress(actual) !== getAddress(expected)) {
    throw new EchoError(
      ErrorCodes.KYBER_API_ERROR,
      `Router address mismatch: API returned ${actual}, expected ${expected}`,
      "This may indicate an API issue. Do not approve or send transactions.",
    );
  }
}

// ── Allowance management ────────────────────────────────────────────

export interface ApproveResult {
  txHash: Hex;
  resetTxHash?: Hex;
}

/**
 * Ensure ERC-20 allowance is sufficient. Approve if needed.
 * Handles USDT-style tokens that require reset to 0 before new approval.
 *
 * @param publicClient - viem PublicClient for the target chain
 * @param walletClient - viem WalletClient for signing
 * @param token - ERC-20 token address
 * @param spender - Spender to approve (validated against KYBER_KNOWN_SPENDERS)
 * @param requiredAmount - Minimum allowance needed
 * @param approveExact - If true, approve exact amount; otherwise maxUint256
 */
export async function ensureKyberAllowance(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  token: Address,
  spender: Address,
  requiredAmount: bigint,
  approveExact = false,
): Promise<ApproveResult | null> {
  validateKyberSpender(spender);

  const owner = walletClient.account!.address;

  const currentAllowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });

  if (currentAllowance >= requiredAmount) {
    logger.debug({ event: "kyberswap.allowance.sufficient", token, spender, current: currentAllowance.toString() });
    return null;
  }

  let resetTxHash: Hex | undefined;

  // USDT-style reset: if current > 0 and < required, reset to 0 first
  if (currentAllowance > 0n && currentAllowance < requiredAmount) {
    logger.debug({ event: "kyberswap.allowance.reset", token, spender });
    try {
      resetTxHash = await walletClient.writeContract({
        account: walletClient.account!,
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, 0n],
      });
      await publicClient.waitForTransactionReceipt({ hash: resetTxHash });
    } catch (err) {
      throw new EchoError(ErrorCodes.APPROVAL_FAILED, `Failed to reset allowance: ${err instanceof Error ? err.message : err}`);
    }
  }

  const approveAmount = approveExact ? requiredAmount : maxUint256;

  try {
    logger.debug({ event: "kyberswap.allowance.approve", token, spender, amount: approveAmount.toString() });
    const txHash = await walletClient.writeContract({
      account: walletClient.account!,
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, approveAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash, resetTxHash };
  } catch (err) {
    throw new EchoError(ErrorCodes.APPROVAL_FAILED, `Failed to approve: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Transaction sending ─────────────────────────────────────────────

/**
 * Send a pre-built KyberSwap transaction (swap, cancel, zap).
 *
 * @returns Transaction hash
 */
export async function sendKyberTransaction(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  params: { to: Address; data: Hex; value?: bigint },
): Promise<Hex> {
  try {
    const txHash = await walletClient.sendTransaction({
      account: walletClient.account!,
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
      chain: walletClient.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  } catch (err) {
    throw new EchoError(ErrorCodes.SWAP_FAILED, `Transaction failed: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Send a KyberSwap transaction and return both hash and receipt.
 * Used by zap.in to extract NFT position ID from receipt logs.
 */
export async function sendKyberTransactionWithReceipt(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  params: { to: Address; data: Hex; value?: bigint },
): Promise<{ hash: Hex; receipt: { logs: Array<{ address: string; topics: string[]; data: string }> } }> {
  try {
    const hash = await walletClient.sendTransaction({
      account: walletClient.account!,
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
      chain: walletClient.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return {
      hash,
      receipt: {
        logs: receipt.logs.map(l => ({
          address: l.address,
          topics: l.topics as string[],
          data: l.data,
        })),
      },
    };
  } catch (err) {
    throw new EchoError(ErrorCodes.SWAP_FAILED, `Transaction failed: ${err instanceof Error ? err.message : err}`);
  }
}
