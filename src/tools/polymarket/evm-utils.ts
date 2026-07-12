/**
 * Polymarket EVM utilities — Polygon viem clients + USDC.e approval.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  maxUint256,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { VexError, ErrorCodes } from "../../errors.js";
import { waitForSuccessfulReceipt } from "@tools/evm-chains/receipt-guard.js";
import { POLY_KNOWN_SPENDERS, POLYGON_RPC } from "./constants.js";
import logger from "../../utils/logger.js";

const RPC_TIMEOUT_MS = 30_000;
const RPC_RETRY_COUNT = 2;

// ── Minimal ERC-20 ABI ──────────────────────────────────────────────

const ERC20_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// ── Client creation ─────────────────────────────────────────────────

export interface PolygonClients {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain>;
}

export function getPolygonClients(privateKey: Hex): PolygonClients {
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(POLYGON_RPC, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as PublicClient<Transport, Chain>;

  const walletClient = createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: polygon,
    transport: http(POLYGON_RPC, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as WalletClient<Transport, Chain>;

  return { publicClient, walletClient };
}

// ── Spender validation ──────────────────────────────────────────────

export function validatePolySpender(address: Address): void {
  if (!POLY_KNOWN_SPENDERS.has(address.toLowerCase())) {
    throw new VexError(
      ErrorCodes.INVALID_SPENDER,
      `Spender ${address} is not a known Polymarket contract`,
      "Known: CTF Exchange, Neg Risk CTF Exchange",
    );
  }
}

// ── USDC.e Approval ─────────────────────────────────────────────────

export async function approveUsdce(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  token: Address,
  spender: Address,
  requiredAmount: bigint,
  approveExact = false,
): Promise<Hex | null> {
  validatePolySpender(spender);

  const owner = walletClient.account!.address;
  const currentAllowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });

  if (currentAllowance >= requiredAmount) {
    logger.debug({ event: "polymarket.allowance.sufficient", token, spender });
    return null;
  }

  // USDT-style reset if needed
  if (currentAllowance > 0n && currentAllowance < requiredAmount) {
    logger.debug({ event: "polymarket.allowance.reset", token, spender });
    const resetHash = await walletClient.writeContract({
      account: walletClient.account!,
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, 0n],
    });
    await waitForSuccessfulReceipt(publicClient, resetHash, {
      code: ErrorCodes.APPROVAL_FAILED,
      what: "Allowance-reset transaction",
      hint: "The existing allowance was not cleared, so the follow-up approve would be blocked. Check the transaction hash before retrying.",
    });
  }

  const amount = approveExact ? requiredAmount : maxUint256;
  logger.debug({ event: "polymarket.allowance.approve", token, spender, amount: amount.toString() });

  const txHash = await walletClient.writeContract({
    account: walletClient.account!,
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
  });
  await waitForSuccessfulReceipt(publicClient, txHash, {
    code: ErrorCodes.APPROVAL_FAILED,
    what: "Approval transaction",
    hint: "The Polymarket contract was not granted an allowance. Check the transaction hash before retrying.",
  });
  return txHash;
}
