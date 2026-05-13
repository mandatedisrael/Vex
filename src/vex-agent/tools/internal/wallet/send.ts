/**
 * Wallet send handlers — prepare + confirm transfers (Solana + EVM multi-chain).
 */

import { requireEvmWallet, requireSolanaWallet } from "@tools/wallet/multi-auth.js";
import type { Address } from "viem";

import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { str } from "../types.js";

function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}

function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

// ── In-memory intent store (per-process, cleared on restart) ─────

interface TransferIntent {
  id: string;
  network: "eip155" | "solana";
  chain?: string;  // EVM chain alias. Required for eip155; ignored for solana.
  to: string;
  amount: string;
  token: string | null;
  createdAt: number;
}

const pendingIntents = new Map<string, TransferIntent>();
let intentCounter = 0;

// ── wallet_send_prepare ──────────────────────────────────────────

export async function handleWalletSendPrepare(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const network = str(params, "network") as "eip155" | "solana";
  const to = str(params, "to");
  const amount = str(params, "amount");
  const token = str(params, "token") || null;

  if (!network || !to || !amount) {
    return fail("Missing required: network, to, amount");
  }

  if (network !== "eip155" && network !== "solana") {
    return fail("network must be eip155 or solana");
  }

  const chain = str(params, "chain") || undefined;
  if (network === "eip155" && !chain) {
    return fail("Missing required: chain for eip155 transfers");
  }

  // Validate amount is numeric
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return fail(`Invalid amount: ${amount}`);
  }

  // Validate sender has wallet configured
  if (network === "solana") {
    requireSolanaWallet(); // throws if not configured
  } else {
    requireEvmWallet(); // throws if not configured
  }

  // Create intent
  intentCounter++;
  const intentId = `intent-${Date.now()}-${intentCounter}`;
  const intent: TransferIntent = {
    id: intentId,
    network,
    chain,
    to,
    amount,
    token,
    createdAt: Date.now(),
  };
  pendingIntents.set(intentId, intent);

  // Clean old intents (>10 min)
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, i] of pendingIntents) {
    if (i.createdAt < cutoff) pendingIntents.delete(id);
  }

  return ok({
    intentId,
    network,
    chain,
    to,
    amount,
    token: token ?? "native",
    status: "prepared",
    message: "Use wallet_send_confirm to broadcast this transfer.",
  });
}

// ── wallet_send_confirm ──────────────────────────────────────────

export async function handleWalletSendConfirm(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const network = str(params, "network") as "eip155" | "solana";
  const intentId = str(params, "intentId");

  if (!network || !intentId) {
    return fail("Missing required: network, intentId");
  }

  const intent = pendingIntents.get(intentId);
  if (!intent) {
    return fail(`Intent not found: ${intentId}. It may have expired (10 min TTL) or was already used.`);
  }

  if (intent.network !== network) {
    return fail(`Network mismatch: intent is ${intent.network}, got ${network}`);
  }

  // Approval gate — mutating tool, requires approval under restricted permission.
  // (Codex review round 1 RED 1 — this gate is parallel to runtime.ts:105
  // and must use the same permission axis as the central gate.)
  if (!context.approved && context.sessionPermission === "restricted") {
    // DON'T delete intent — must survive until approval retry
    return {
      success: false,
      output: `Transfer requires approval under restricted permission. Use the approval flow to confirm.`,
      pendingApproval: true,
    };
  }

  // Remove intent (one-time use) — only after approval check passes
  pendingIntents.delete(intentId);

  if (network === "solana") {
    return executeSolanaTransfer(intent);
  }

  return executeEvmTransfer(intent);
}

// ── Solana transfer execution ────────────────────────────────────

async function executeSolanaTransfer(intent: TransferIntent): Promise<ToolResult> {
  const [{ Keypair }, { sendSol, sendSplToken }, { resolveJupiterToken }] = await Promise.all([
    import("@solana/web3.js"),
    import("@tools/solana-ecosystem/shared/solana-transfer.js"),
    import("@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js"),
  ]);
  const wallet = requireSolanaWallet();
  const keypair = Keypair.fromSecretKey(wallet.secretKey);

  if (!intent.token || intent.token === "native" || intent.token.toUpperCase() === "SOL") {
    // Native SOL transfer
    const lamports = BigInt(Math.round(Number(intent.amount) * 1e9));
    const result = await sendSol({ from: keypair, to: intent.to, lamports });
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "transfer",
          chain: "solana",
          status: "executed",
          inputToken: "SOL",
          inputAmount: intent.amount,
          outputToken: "SOL",
          outputAmount: intent.amount,
          signature: result.signature,
        },
      },
    };
  }

  // SPL token transfer
  let tokenMeta;
  try {
    tokenMeta = await resolveJupiterToken(intent.token);
  } catch {
    // resolveJupiterToken may throw if JUPITER_API_KEY is missing
  }
  if (!tokenMeta) {
    return fail(`Token not found: ${intent.token}`);
  }

  const atomicAmount = BigInt(Math.round(Number(intent.amount) * 10 ** tokenMeta.decimals));
  const result = await sendSplToken({
    from: keypair,
    to: intent.to,
    mint: tokenMeta.address,
    amount: atomicAmount,
    decimals: tokenMeta.decimals,
  });

  return {
    success: true,
    output: JSON.stringify(result, null, 2),
    data: {
      ...result,
      _tradeCapture: {
        type: "transfer",
        chain: "solana",
        status: "executed",
        inputToken: tokenMeta.symbol,
        inputAmount: intent.amount,
        outputToken: tokenMeta.symbol,
        outputAmount: intent.amount,
        signature: result.signature,
      },
    },
  };
}

// ── EVM transfer execution (dynamic chain: native + ERC-20 + ERC-721) ──

async function executeEvmTransfer(intent: TransferIntent): Promise<ToolResult> {
  const { createDynamicPublicClient, createDynamicWalletClient } = await import("@tools/khalani/evm-client.js");
  const { getKhalaniClient } = await import("@tools/khalani/client.js");
  const { resolveChainId, getChain } = await import("@tools/khalani/chains.js");
  const { parseUnits, getAddress } = await import("viem");

  const wallet = requireEvmWallet();
  const chains = await getKhalaniClient().getChains();
  const chainAlias = intent.chain;
  if (!chainAlias) {
    return fail("Missing required: chain for eip155 transfers");
  }
  const chainId = resolveChainId(chainAlias, chains);
  const chain = getChain(chainId, chains);
  const publicClient = createDynamicPublicClient(chain, chains);
  const walletClient = createDynamicWalletClient(chain, chains, wallet.privateKey as `0x${string}`);

  const isNft = intent.token?.startsWith("nft:");
  const isNative = !intent.token || intent.token === "native";
  const chainName = chain.name || chainAlias;

  let hash: `0x${string}`;
  let tokenSymbol = chain.nativeCurrency.symbol;

  if (isNative) {
    const value = parseUnits(intent.amount, chain.nativeCurrency.decimals);
    hash = await walletClient.sendTransaction({
      to: getAddress(intent.to),
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
      abi: [{
        inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "tokenId", type: "uint256" }],
        name: "safeTransferFrom", outputs: [], stateMutability: "nonpayable", type: "function",
      }] as const,
      functionName: "safeTransferFrom",
      args: [wallet.address as `0x${string}`, getAddress(intent.to), nftTokenId],
      chain: undefined,
    });
  } else {
    const tokenAddress = getAddress(intent.token!);
    tokenSymbol = intent.token!;

    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: [{ inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" }] as const,
      functionName: "decimals",
    });
    const value = parseUnits(intent.amount, decimals);

    hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: [{
        inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
        name: "transfer", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function",
      }] as const,
      functionName: "transfer",
      args: [getAddress(intent.to), value],
      chain: undefined,
    });
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    success: true,
    output: JSON.stringify({
      txHash: hash,
      chain: chainName,
      status: receipt.status === "success" ? "confirmed" : "failed",
      blockNumber: Number(receipt.blockNumber),
    }, null, 2),
    data: {
      txHash: hash,
      _tradeCapture: {
        type: isNft ? "send" : "transfer",
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
}
