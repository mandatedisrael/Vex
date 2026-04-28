/**
 * Retrieval metadata for KyberSwap tokens tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `kyberswap/manifests/tokens.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KYBER_SWAP_CHAINS } from "../../kyberswap/discovery-text.js";

export const KYBERSWAP_TOKENS_DISCOVERY = {
  "kyberswap.tokens.search": {
    embeddingText: embeddingText(
      `Look up an EVM token by name, symbol, or address on a specific chain — get the contract address, decimals, market cap, and whether it's verified. ` +
      `Use this when the user names a token by ticker (USDC, ETH, PEPE, that BONK on base) and you need the exact contract before swapping or placing an order. ` +
      `Example queries: find usdc address on base, lookup pepe on arbitrum, what's the contract for shib, search token on bnb chain, resolve this ticker on optimism. ` +
      `Run this before any KyberSwap swap or limit order.`,
    ),
    aliases: ["token search", "find token", "token resolver", "ERC20 metadata", "whitelisted token"],
    exampleIntents: ["find USDC address on base", "search token before swap", "resolve ERC20 symbol"],
    chains: KYBER_SWAP_CHAINS,
  },

  "kyberswap.tokens.check": {
    embeddingText: embeddingText(
      `Check whether an EVM token is a honeypot or has a fee-on-transfer tax before trading it. ` +
      `Use this when the user wants a safety check on a token, asks if a coin is a scam, suspects fee-on-transfer behavior, or wants to verify a memecoin before aping in. ` +
      `Example queries: is this token a honeypot, check fee on transfer for pepe, is this coin safe, scam check this token, fot tax on this contract, can I trade this safely. ` +
      `Critical safety check for unknown or new tokens.`,
    ),
    aliases: ["honeypot", "fee on transfer", "FOT", "token tax", "token safety", "scam token"],
    exampleIntents: ["check if token is honeypot", "fee on transfer tax check", "is this token safe to trade"],
    chains: KYBER_SWAP_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 2;
if (Object.keys(KYBERSWAP_TOKENS_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `KYBERSWAP_TOKENS_DISCOVERY has ${Object.keys(KYBERSWAP_TOKENS_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
