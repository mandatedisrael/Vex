/**
 * Wallet tools — read state and prepare/confirm transfers.
 *
 * `wallet_send_prepare` returns an intent ID; `wallet_send_confirm` broadcasts.
 * Confirm is the only mutating tool here.
 */

import type { ToolDef } from "../types.js";

export const WALLET_TOOLS: readonly ToolDef[] = [
  {
    name: "wallet_balances", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description: "Read your token balances on every chain Vex can reach: Khalani-covered chains via Khalani, plus local chains like Robinhood Chain (4663) read directly from RPC. Defaults to your personal wallets — both EVM (`eip155`) and Solana — aggregated in one call. Pass `wallet` or `chainIds` only when you want to narrow the scan.",
    parameters: { type: "object", properties: {
      wallet: { type: "string", enum: ["eip155", "solana", "all"], description: "Which wallet family to read. Default 'all' aggregates your EVM + Solana wallets." },
      chainIds: { type: "string", description: "Optional. Omit (or pass empty) to scan all supported chains (Khalani + local). To restrict, pass comma-separated chain IDs/aliases like 'ethereum,base,solana' or 'robinhood'." },
      response_format: { type: "string", enum: ["concise", "detailed"], description: "Output verbosity. Default 'detailed' returns every token per wallet. Set 'concise' to enable the `limit` trim (top tokens by held USD value)." },
      limit: { type: "number", description: "Optional. Max tokens returned per wallet snapshot, top-N by held USD value. Only applied when response_format='concise'; ignored under the default 'detailed'. `tokenCount`/`totalUsd` always reflect the full scan." },
    } },
  },
  {
    name: "wallet_track_token", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "local_write",
    description: "Pin an ERC-20 token on a LOCAL chain (e.g. Robinhood 4663) so `wallet_balances` and the portfolio track it. Local chains scan a fixed set (seed tokens + pins); pin any token received by transfer or airdrop — swap and bridge executes auto-pin theirs. DB-only bookmark: no on-chain transaction. Khalani-covered chains do not need pinning.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["pin", "unpin", "list"], description: "pin adds a token to tracking, unpin removes it, list shows the chain's seed + pinned set." },
      chain: { type: "string", description: "Local chain alias or id (e.g. 'robinhood', '4663')." },
      token: { type: "string", description: "ERC-20 contract ADDRESS (0x…). Required for pin/unpin; ignored for list. Resolve a symbol to its address first." },
    }, required: ["action", "chain"] },
  },
  {
    name: "wallet_send_prepare", kind: "internal", mutating: false, pressureSafety: "mutating", actionKind: "approval_prepare",
    description: "Prepare a transfer intent (no broadcast). Returns intent ID for confirmation. Supports native tokens, ERC-20, and ERC-721 on any EVM chain. Solana: SOL + SPL tokens only (no pNFT/cNFT).",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Network family" },
      chain: { type: "string", description: "Required for eip155. EVM chain ID or alias (e.g. 'polygon', '137', 'base'). Ignored for solana." },
      to: { type: "string", description: "Recipient address" },
      amount: { type: "string", description: "Amount in user-facing units (for native/ERC-20) or '1' for ERC-721" },
      token: { type: "string", description: "Token: 'native' for chain native, contract address for ERC-20, 'nft:{contract}:{tokenId}' for ERC-721. Solana: symbol or mint (SOL + SPL only, NFT not supported)." },
    }, required: ["network", "to", "amount"] },
  },
  {
    name: "wallet_send_confirm", kind: "internal", mutating: true, pressureSafety: "mutating", actionKind: "user_wallet_broadcast",
    description: "Confirm and broadcast a prepared transfer. Requires approval in restricted/off mode.",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Network family" },
      intentId: { type: "string", description: "Prepared intent ID" },
    }, required: ["network", "intentId"] },
  },
];
