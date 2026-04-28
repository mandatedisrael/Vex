/**
 * Retrieval metadata for Khalani tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `khalani/manifest.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KHALANI_CHAINS } from "../../khalani/discovery-text.js";

export const KHALANI_MAIN_DISCOVERY = {
  "khalani.chains.list": {
    embeddingText: embeddingText(
      `List every chain Khalani can bridge to or from — 40+ networks including Ethereum, Solana, Base, Arbitrum, BNB Chain, Polygon, Avalanche, Optimism, Linea, zkSync and others, both EVM and Solana. ` +
      `Use this when the user wants to know what chains the bridge supports, asks if a specific network can be bridged, or wants to see chain metadata before transferring. ` +
      `Example queries: what chains can I bridge to, list khalani supported networks, can I bridge to solana, what evm chains support bridging, supported bridge routes.`,
    ),
    chains: KHALANI_CHAINS,
  },

  "khalani.tokens.top": {
    embeddingText: embeddingText(
      `List the most popular bridge-supported tokens — USDC, ETH, SOL, USDT, WETH and other major assets — across the 40+ chains Khalani supports. ` +
      `Use this when the user wants to know what tokens are commonly bridged, see top assets per chain, or browse popular cross-chain coins before deciding what to move. ` +
      `Example queries: top bridge tokens on base, popular cross-chain coins, what major tokens does khalani support, list common bridge assets, popular tokens to bridge.`,
    ),
    chains: KHALANI_CHAINS,
  },

  "khalani.tokens.search": {
    embeddingText: embeddingText(
      `Look up a token by name, symbol, or address across 40+ EVM and Solana chains — the canonical cross-chain resolver. ` +
      `Use this when the user names a token by ticker or partial name (USDC, ETH, SOL, PEPE) and you need the exact contract address on the source or destination chain before swapping or bridging. ` +
      `Example queries: find usdc address on base, what's the address of pepe on eth, lookup sol mint, resolve this ticker on solana, find token contract on arb. ` +
      `Run this before any swap or bridge.`,
    ),
    chains: KHALANI_CHAINS,
  },

  "khalani.tokens.autocomplete": {
    embeddingText: embeddingText(
      `Parse natural-language token plus amount plus chain phrases like '100 usdc on ethereum' or '50 eth on base' into structured suggestions for the next slot. ` +
      `Use this when the user types a partial bridge or swap intent and you need to auto-fill a form, suggest token completions, parse a freeform query, or guide them to the next field. ` +
      `Example queries: parse 100 usdc on eth, autocomplete 50 sol, what tokens match eth on base, suggest tokens for this query, fill in the bridge form.`,
    ),
    chains: KHALANI_CHAINS,
  },

  "khalani.tokens.balances": {
    embeddingText: embeddingText(
      `Get a wallet's token balances across multiple EVM and Solana chains, with USD prices included. ` +
      `Use this when the user wants to check their portfolio, see what they hold across chains, find available source assets before bridging or swapping, or get USD value of their holdings. ` +
      `Example queries: what's my balance, show my portfolio across chains, how much usdc do I have, check my wallet on solana, find available funds before bridging, total holdings, my crypto worth.`,
    ),
    chains: KHALANI_CHAINS,
  },

  "khalani.quote.get": {
    embeddingText: embeddingText(
      `Preview a cross-chain bridge — get expected output amount, routes, ETA, and gas cost before executing. ` +
      `Use this when the user wants to know what they'd receive when bridging, compare bridge routes, check ETA before transferring, or simulate a cross-chain transfer. ` +
      `Example queries: how much usdc would I get bridging from eth to solana, preview bridge from base to arbitrum, what's the eta to bridge, compare bridge routes, simulate cross-chain transfer. ` +
      `Read-only — does not execute.`,
    ),
    chains: KHALANI_CHAINS,
  },

  "khalani.orders.list": {
    embeddingText: embeddingText(
      `List a wallet's bridge orders on Khalani — paginated, filterable by source chain, destination chain, order ID, or transaction hash. ` +
      `Use this when the user wants to see their bridge history, track multiple in-flight transfers, look up a specific bridge by tx hash, or audit cross-chain activity. ` +
      `Example queries: show my bridge history, list my recent bridges, find my bridge by tx hash, track bridges from eth to base, my pending cross-chain transfers.`,
    ),
    chains: KHALANI_CHAINS,
  },

  "khalani.orders.get": {
    embeddingText: embeddingText(
      `Get full lifecycle details of a single Khalani bridge order — status, deposit and fill and refund transactions, source and destination, amounts, provider details. ` +
      `Use this when the user wants to inspect one specific bridge, troubleshoot a stuck transfer, see the deep details of a cross-chain order, or check completion status. ` +
      `Example queries: status of my bridge order abc123, why is my bridge stuck, full details for this cross-chain transfer, look up this bridge order, troubleshoot a bridge.`,
    ),
    chains: KHALANI_CHAINS,
  },

  "khalani.bridge": {
    embeddingText: embeddingText(
      `Move tokens between blockchains — bridge across Ethereum, Solana, Base, Arbitrum, BNB Chain, Polygon, Avalanche and 35+ other EVM and Solana chains. ` +
      `Use this when the user wants to bridge funds, move tokens cross-chain, get assets onto another network, send USDC from Ethereum to Solana, transfer to Base, or get out of one chain into another. ` +
      `Example queries: bridge usdc from eth to solana, move funds to base, send sol from solana to ethereum, get tokens onto arb, cross-chain transfer, get my eth onto solana.`,
    ),
    canonicalSummary: "Execute a cross-chain bridge transfer across 40+ EVM and Solana chains.",
    preferredFor: ["cross-chain bridge", "bridge funds", "bridge tokens", "cross chain transfer"],
    chains: KHALANI_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 9;
if (Object.keys(KHALANI_MAIN_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `KHALANI_MAIN_DISCOVERY has ${Object.keys(KHALANI_MAIN_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
