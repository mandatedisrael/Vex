/**
 * KyberSwap NFT approval operations: ERC-721 and ERC-1155.
 */

import {
  getAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Transport,
} from "viem";
import { EchoError, ErrorCodes } from "../../../errors.js";
import logger from "../../../utils/logger.js";
import { validateKyberSpender } from "./erc20.js";

// ── ERC-721 approval ───────────────────────────────────────────────

const ERC721_ABI = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getApproved",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "owner", type: "address" }, { name: "operator", type: "address" }],
    name: "isApprovedForAll",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }],
    name: "approve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Ensure ERC-721 NFT is approved for a spender. Approve if needed.
 */
export async function ensureErc721Approval(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  nftContract: Address,
  tokenId: bigint,
  spender: Address,
): Promise<Hex | null> {
  validateKyberSpender(spender);
  const owner = walletClient.account!.address;

  // Check isApprovedForAll first — many DEXes (Algebra, Velodrome) use operator approval
  try {
    const operatorApproved = await publicClient.readContract({
      address: nftContract,
      abi: ERC721_ABI,
      functionName: "isApprovedForAll",
      args: [owner, spender],
    });
    if (operatorApproved) {
      logger.debug({ event: "kyberswap.erc721.operator_approved", nftContract, spender });
      return null;
    }
  } catch {
    logger.debug({ event: "kyberswap.erc721.isApprovedForAll_failed", nftContract });
  }

  // Check per-token approval
  try {
    const approved = await publicClient.readContract({
      address: nftContract,
      abi: ERC721_ABI,
      functionName: "getApproved",
      args: [tokenId],
    });

    if (getAddress(approved) === getAddress(spender)) {
      logger.debug({ event: "kyberswap.erc721.already_approved", nftContract, tokenId: tokenId.toString(), spender });
      return null;
    }
  } catch {
    logger.debug({ event: "kyberswap.erc721.getApproved_failed", nftContract, tokenId: tokenId.toString() });
  }

  try {
    logger.debug({ event: "kyberswap.erc721.approve", nftContract, tokenId: tokenId.toString(), spender });
    const txHash = await walletClient.writeContract({
      account: walletClient.account!,
      address: nftContract,
      abi: ERC721_ABI,
      functionName: "approve",
      args: [spender, tokenId],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  } catch (err) {
    throw new EchoError(ErrorCodes.APPROVAL_FAILED, `ERC-721 approve failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── ERC-1155 approval ──────────────────────────────────────────────

const ERC1155_ABI = [
  {
    inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }],
    name: "isApprovedForAll",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Ensure ERC-1155 setApprovalForAll for a spender. Approve if needed.
 */
export async function ensureErc1155ApprovalForAll(
  publicClient: PublicClient<Transport, Chain>,
  walletClient: WalletClient<Transport, Chain>,
  contract: Address,
  operator: Address,
): Promise<Hex | null> {
  validateKyberSpender(operator);

  const owner = walletClient.account!.address;

  try {
    const approved = await publicClient.readContract({
      address: contract,
      abi: ERC1155_ABI,
      functionName: "isApprovedForAll",
      args: [owner, operator],
    });

    if (approved) {
      logger.debug({ event: "kyberswap.erc1155.already_approved", contract, operator });
      return null;
    }
  } catch {
    logger.debug({ event: "kyberswap.erc1155.isApprovedForAll_failed", contract, operator });
  }

  try {
    logger.debug({ event: "kyberswap.erc1155.setApprovalForAll", contract, operator });
    const txHash = await walletClient.writeContract({
      account: walletClient.account!,
      address: contract,
      abi: ERC1155_ABI,
      functionName: "setApprovalForAll",
      args: [operator, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  } catch (err) {
    throw new EchoError(ErrorCodes.APPROVAL_FAILED, `ERC-1155 setApprovalForAll failed: ${err instanceof Error ? err.message : err}`);
  }
}
