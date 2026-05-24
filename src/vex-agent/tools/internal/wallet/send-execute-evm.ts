/**
 * Wallet send — EVM executor (multi-chain via Khalani).
 *
 * Refactor of the pre-phase-4 `executeEvmTransfer`: `hash` lives in the
 * outer scope so a `waitForTransactionReceipt` failure can return
 * `chain_failed` / `confirmation_unknown` with the hash intact (Codex
 * puzzle-5 phase-4 review v3 acceptance).
 */

import { createHash } from "node:crypto";

import { requireEvmWallet } from "@tools/wallet/multi-auth.js";

import type { WalletIntent } from "@vex-agent/db/repos/wallet-intents.js";

import {
  preBroadcastFailed,
  summarizeWalletError,
  type ExecuteOutcome,
} from "./send-types.js";

export async function executeEvmTransfer(
  intent: WalletIntent,
): Promise<ExecuteOutcome> {
  let publicClient;
  let wallet;
  let chainName: string;
  let tokenSymbol: string;
  let hash: `0x${string}`;
  let isNftTransfer = false;

  // Setup + broadcast — any throw is pre-broadcast.
  try {
    const { createDynamicPublicClient, createDynamicWalletClient } =
      await import("@tools/khalani/evm-client.js");
    const { getKhalaniClient } = await import("@tools/khalani/client.js");
    const { resolveChainId, getChain } = await import(
      "@tools/khalani/chains.js"
    );
    const { parseUnits, getAddress } = await import("viem");

    wallet = requireEvmWallet();
    const chains = await getKhalaniClient().getChains();
    if (intent.chainAlias === null) {
      return preBroadcastFailed(
        new Error("Missing chain for eip155 transfer"),
      );
    }
    const chainId = resolveChainId(intent.chainAlias, chains);
    const chain = getChain(chainId, chains);
    publicClient = createDynamicPublicClient(chain, chains);
    const walletClient = createDynamicWalletClient(
      chain,
      chains,
      wallet.privateKey as `0x${string}`,
    );

    const isNft = intent.token?.startsWith("nft:");
    isNftTransfer = isNft === true;
    const isNative = intent.token === null || intent.token === "native";
    chainName = chain.name || intent.chainAlias;
    tokenSymbol = chain.nativeCurrency.symbol;

    if (isNative) {
      const value = parseUnits(intent.amount, chain.nativeCurrency.decimals);
      hash = await walletClient.sendTransaction({
        to: getAddress(intent.toAddress),
        value,
        chain: undefined,
      });
    } else if (isNft) {
      const parts = intent.token!.split(":");
      const nftContract = getAddress(parts[1]);
      const nftTokenId = BigInt(parts[2]);
      tokenSymbol = `NFT#${nftTokenId}`;
      hash = await walletClient.writeContract({
        address: nftContract,
        abi: [
          {
            inputs: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "tokenId", type: "uint256" },
            ],
            name: "safeTransferFrom",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ] as const,
        functionName: "safeTransferFrom",
        args: [
          wallet.address as `0x${string}`,
          getAddress(intent.toAddress),
          nftTokenId,
        ],
        chain: undefined,
      });
    } else {
      const tokenAddress = getAddress(intent.token!);
      tokenSymbol = intent.token!;
      const decimals = await publicClient.readContract({
        address: tokenAddress,
        abi: [
          {
            inputs: [],
            name: "decimals",
            outputs: [{ type: "uint8" }],
            stateMutability: "view",
            type: "function",
          },
        ] as const,
        functionName: "decimals",
      });
      const value = parseUnits(intent.amount, decimals);
      hash = await walletClient.writeContract({
        address: tokenAddress,
        abi: [
          {
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            name: "transfer",
            outputs: [{ type: "bool" }],
            stateMutability: "nonpayable",
            type: "function",
          },
        ] as const,
        functionName: "transfer",
        args: [getAddress(intent.toAddress), value],
        chain: undefined,
      });
    }
  } catch (cause) {
    return preBroadcastFailed(cause);
  }

  // Broadcast happened — `hash` is set. Receipt-wait throws are
  // confirmation_unknown; receipt.status !== 'success' is chain_failed.
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      const errorHash = createHash("sha256")
        .update(`evm-revert:${hash}`)
        .digest("hex")
        .slice(0, 16);
      return {
        kind: "chain_failed",
        txHash: hash,
        errorKind: "ChainRevert",
        errorHash,
      };
    }
    return {
      kind: "confirmed",
      txHash: hash,
      data: {
        txHash: hash,
        chain: chainName,
        status: "confirmed",
        blockNumber: Number(receipt.blockNumber),
        _tradeCapture: {
          type: isNftTransfer ? "send" : "transfer",
          chain: chainName,
          status: "executed",
          inputToken: tokenSymbol,
          inputAmount: intent.amount,
          outputToken: tokenSymbol,
          outputAmount: intent.amount,
          signature: hash,
          walletAddress: wallet.address,
        },
      },
    };
  } catch (cause) {
    const sum = summarizeWalletError(cause);
    return {
      kind: "confirmation_unknown",
      txHash: hash,
      errorKind: sum.errorKind,
      errorHash: sum.errorHash,
    };
  }
}
