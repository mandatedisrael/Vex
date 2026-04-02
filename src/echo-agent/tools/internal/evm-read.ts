/**
 * EVM read tool — on-chain reads via khalani chain discovery + viem public client.
 *
 * Read-only, scoped actions:
 *   tx_receipt     — transaction receipt (status, gasUsed, logs count)
 *   erc721_mint    — extract minted NFT IDs from receipt logs
 *   erc20_metadata — decimals, symbol, name from contract
 *   balance        — native token balance
 *
 * Chain resolution: khalani.getChains() → resolveChainId → createDynamicPublicClient.
 */

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { getKhalaniClient } from "@tools/khalani/client.js";
import { resolveChainId, getChain } from "@tools/khalani/chains.js";
import { createDynamicPublicClient } from "@tools/khalani/evm-client.js";
import { extractMintedNftId } from "@tools/kyberswap/evm-utils.js";
import logger from "@utils/logger.js";

function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}

export async function handleEvmRead(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const action = str(params, "action");
  const chainIdRaw = str(params, "chainId");

  if (!action) return { success: false, output: "Missing required: action" };
  if (!chainIdRaw) return { success: false, output: "Missing required: chainId" };

  // Resolve chain via khalani
  const chains = await getKhalaniClient().getChains();
  const chainId = resolveChainId(chainIdRaw, chains);
  const chain = getChain(chainId, chains);
  const client = createDynamicPublicClient(chain, chains);

  switch (action) {
    case "tx_receipt": {
      const txHash = str(params, "txHash");
      if (!txHash) return { success: false, output: "Missing required: txHash" };

      const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
      return {
        success: true,
        output: JSON.stringify({
          chain: chain.name,
          chainId,
          txHash,
          status: receipt.status,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed.toString(),
          logsCount: receipt.logs.length,
          from: receipt.from,
          to: receipt.to,
          contractAddress: receipt.contractAddress,
        }, null, 2),
      };
    }

    case "erc721_mint": {
      const txHash = str(params, "txHash");
      const recipient = str(params, "address");
      if (!txHash) return { success: false, output: "Missing required: txHash" };

      const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
      const logs = receipt.logs.map(l => ({
        address: l.address,
        topics: l.topics as string[],
        data: l.data,
      }));

      // If recipient given, filter to that address; otherwise find any mint
      const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
      const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

      const mints: Array<{ contract: string; tokenId: string; to: string }> = [];
      for (const log of logs) {
        if (
          log.topics[0] === TRANSFER_TOPIC &&
          log.topics.length === 4 &&
          log.topics[1] === ZERO
        ) {
          const to = "0x" + (log.topics[2]?.slice(26) ?? "");
          if (recipient && to.toLowerCase() !== recipient.toLowerCase()) continue;
          mints.push({
            contract: log.address,
            tokenId: BigInt(log.topics[3]).toString(),
            to,
          });
        }
      }

      // Also provide filtered result via extractMintedNftId if recipient given
      const primaryNftId = recipient ? extractMintedNftId(logs, recipient) : mints[0]?.tokenId;

      return {
        success: true,
        output: JSON.stringify({
          chain: chain.name,
          chainId,
          txHash,
          mintsFound: mints.length,
          primaryNftId: primaryNftId ?? null,
          mints,
        }, null, 2),
      };
    }

    case "erc20_metadata": {
      const address = str(params, "address");
      if (!address) return { success: false, output: "Missing required: address" };

      const ERC20_ABI = [
        { inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" },
        { inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
        { inputs: [], name: "name", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
      ] as const;

      let decimals: number | undefined;
      let symbol = "UNKNOWN";
      let name = "Unknown Token";

      try {
        decimals = await client.readContract({ address: address as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" });
      } catch {
        return { success: false, output: `Cannot read decimals for ${address} on ${chain.name} — not a valid ERC-20` };
      }
      try { symbol = await client.readContract({ address: address as `0x${string}`, abi: ERC20_ABI, functionName: "symbol" }); } catch { /* tolerant */ }
      try { name = await client.readContract({ address: address as `0x${string}`, abi: ERC20_ABI, functionName: "name" }); } catch { /* tolerant */ }

      return {
        success: true,
        output: JSON.stringify({ chain: chain.name, chainId, address, decimals, symbol, name }, null, 2),
      };
    }

    case "balance": {
      const address = str(params, "address");
      if (!address) return { success: false, output: "Missing required: address" };

      const balance = await client.getBalance({ address: address as `0x${string}` });
      return {
        success: true,
        output: JSON.stringify({
          chain: chain.name,
          chainId,
          address,
          balanceWei: balance.toString(),
          balanceHuman: (Number(balance) / 1e18).toFixed(6),
          nativeCurrency: chain.nativeCurrency.symbol,
        }, null, 2),
      };
    }

    default:
      return { success: false, output: `Unknown action: ${action}. Valid: tx_receipt, erc721_mint, erc20_metadata, balance` };
  }
}
