/**
 * Retrieval metadata for Polymarket bridge tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/bridge.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { POLYMARKET_BRIDGE_CHAINS } from "../../polymarket/discovery-text.js";

export const POLYMARKET_BRIDGE_DISCOVERY = {
  "polymarket.bridge.assets": {
    embeddingText: embeddingText(
      `List the chains and tokens the Polymarket bridge currently accepts inbound or outbound — Ethereum, Solana, Base, Arbitrum, BNB Chain, Optimism, Bitcoin, HyperEVM, Abstract, Monad, Katana, Lighter and others — with chain IDs, token addresses, decimals, and minimum checkout amount in USD. ` +
      `Use this when the user asks what chains they can deposit from, where they can withdraw to, what tokens are supported, or what the minimum bridge size is. ` +
      `Example queries: what chains does polymarket support, can I deposit btc to polymarket, list polymarket bridge tokens, supported deposit assets, what's the minimum withdrawal. ` +
      `Read-only — does not move funds.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "supported chains", "supported assets",
      "bridge tokens", "minimum checkout",
    ],
    exampleIntents: [
      "what chains does polymarket support",
      "list polymarket bridge tokens",
      "supported deposit assets on polymarket",
    ],
    chains: POLYMARKET_BRIDGE_CHAINS,
  },

  "polymarket.bridge.deposit": {
    canonicalSummary:
      "Create a deposit address to fund your Polymarket prediction market account on Polygon from another chain.",
    embeddingText: embeddingText(
      `Create a deposit address to fund your Polymarket account on Polygon from Ethereum, Solana, Base, Arbitrum, BNB Chain, Bitcoin, HyperEVM and other supported chains — returns EVM, Solana, and/or BTC deposit addresses you then send pUSD or other supported assets to. ` +
      `Use this when the user wants to fund their polymarket account, top up their balance for betting, deposit usdc into polymarket, send btc into polymarket, or get a deposit address before transferring funds. ` +
      `Example queries: fund my polymarket account, deposit usdc into polymarket, send btc to polymarket, polymarket deposit address, top up for betting, get me an inbound bridge address. ` +
      `Creates the address only — the user still has to send funds from their source chain.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "deposit address", "fund polymarket",
      "deposit usdc", "deposit btc", "deposit sol",
      "bridge into polymarket", "top up account",
      "pUSD", "USDC.e", "bridged USDC",
    ],
    exampleIntents: [
      "fund my polymarket account",
      "deposit usdc into polymarket",
      "create polymarket deposit address",
      "send btc to polymarket",
    ],
    preferredFor: ["fund polymarket", "deposit address", "bridge in"],
    chains: POLYMARKET_BRIDGE_CHAINS,
  },

  "polymarket.bridge.withdraw": {
    canonicalSummary:
      "Create a withdrawal route from your Polymarket prediction market account on Polygon to another chain (Ethereum, Solana, Base, BTC, etc.).",
    embeddingText: embeddingText(
      `Create a withdrawal route from your Polymarket account on Polygon to Ethereum, Solana, Base, Arbitrum, BNB Chain, Optimism, Bitcoin and other supported chains — returns the route address to send the bridged token to. ` +
      `Use this when the user wants to cash out polymarket winnings, withdraw their balance, move pUSD off polymarket, send funds back to ethereum or solana, or bridge out to another chain. ` +
      `Example queries: withdraw pUSD from polymarket to base, cash out polymarket winnings, send polymarket funds to ethereum, bridge out to solana, get me off polymarket, withdraw to btc. ` +
      `Creates the route only — the user still has to push funds through it.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "withdraw", "cash out polymarket",
      "bridge out", "withdraw to ethereum",
      "withdraw to base", "withdraw to solana", "withdraw to btc",
      "pUSD", "USDC.e", "bridged USDC",
    ],
    exampleIntents: [
      "withdraw pUSD from polymarket to base",
      "cash out polymarket winnings",
      "send polymarket funds to ethereum",
    ],
    preferredFor: ["withdraw from polymarket", "cash out", "bridge out"],
    chains: POLYMARKET_BRIDGE_CHAINS,
  },

  "polymarket.bridge.quote": {
    canonicalSummary:
      "Preview a cross-chain transfer to or from a Polymarket prediction market account on Polygon — expected output, fees, checkout time.",
    embeddingText: embeddingText(
      `Preview a cross-chain transfer to or from a Polymarket account on Polygon — expected output amount, total fees, and checkout time before executing. ` +
      `Use this when the user wants to know what they'd receive after bridging into or out of polymarket, compare deposit or withdrawal cost, or check the ETA before moving funds. ` +
      `Example queries: preview polymarket bridge, what are the bridge fees from ethereum to polymarket, how long to bridge to polymarket, estimate polymarket withdrawal, compare deposit cost. ` +
      `Read-only — does not move funds.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "bridge quote", "preview bridge",
      "bridge fees", "checkout time",
      "estimated output",
    ],
    exampleIntents: [
      "preview polymarket bridge",
      "what are the bridge fees to polymarket",
      "how long to bridge to polymarket",
    ],
    preferredFor: ["bridge quote", "preview bridge", "estimated checkout"],
    chains: POLYMARKET_BRIDGE_CHAINS,
  },

  "polymarket.bridge.status": {
    embeddingText: embeddingText(
      `Check the status of a Polymarket bridge transaction by address — DEPOSIT_DETECTED, PROCESSING, COMPLETED or FAILED — for both inbound deposits and outbound withdrawals. ` +
      `Use this when the user wants to know if their deposit landed, why their withdrawal is stuck, when their funds will arrive, or to look up the lifecycle of one specific bridge tx. ` +
      `Example queries: status of my polymarket deposit, is my withdrawal done, why is my polymarket bridge stuck, when will my funds arrive, check this bridge tx. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "bridge status", "deposit status",
      "withdrawal status", "transaction status",
      "stuck bridge",
    ],
    exampleIntents: [
      "status of my polymarket deposit",
      "is my polymarket withdrawal done",
      "why is my bridge stuck",
    ],
    chains: POLYMARKET_BRIDGE_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 5;
if (Object.keys(POLYMARKET_BRIDGE_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `POLYMARKET_BRIDGE_DISCOVERY has ${Object.keys(POLYMARKET_BRIDGE_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
