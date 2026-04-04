/**
 * KyberSwap shared helpers — pure domain logic.
 * Extracted from commands/kyberswap/helpers.ts for retained core.
 */

import { isAddress, getAddress, type Address } from "viem";
import { EchoError, ErrorCodes } from "../../errors.js";
import { resolveChainSlug, slugToChainId, chainIdToSlug, getChainFeatures } from "./chains.js";
import { NATIVE_TOKEN_ADDRESS } from "./constants.js";
import { getKyberTokenApiClient } from "./token-api/client.js";
import { readErc20Metadata } from "./evm-utils.js";
import type { KyberChainSlug } from "./types.js";
import type { KyberToken } from "./token-api/types.js";

export interface ResolvedKyberTokenMetadata {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  isNative: boolean;
}

/** Resolve --chain option to validated KyberChainSlug. */
export function resolveChain(chainInput: string): KyberChainSlug {
  return resolveChainSlug(chainInput);
}

/** Resolve --chain and get chain ID. */
export function resolveChainWithId(chainInput: string): { slug: KyberChainSlug; chainId: number } {
  const slug = resolveChainSlug(chainInput);
  return { slug, chainId: slugToChainId(slug) };
}

/** Ensure chain supports a feature, or throw. */
export function requireFeature(slug: KyberChainSlug, feature: "aggregator" | "limitOrder" | "zaas"): void {
  const features = getChainFeatures(slug);
  if (!features[feature]) {
    throw new EchoError(
      ErrorCodes.KYBER_UNSUPPORTED_CHAIN,
      `Chain "${slug}" does not support KyberSwap ${feature}`,
    );
  }
}

/**
 * Resolve a token identifier to an Address.
 * Accepts: hex address, "native"/"ETH", or searches by symbol via Token API.
 */
export async function resolveTokenAddress(input: string, chainId: number): Promise<Address> {
  const lower = input.toLowerCase();

  if (lower === "native" || lower === "eth") {
    return NATIVE_TOKEN_ADDRESS;
  }

  if (isAddress(input)) {
    return getAddress(input);
  }

  // Search by symbol via Token API — whitelisted first, then broader fallback
  const client = getKyberTokenApiClient();
  let tokens = await client.searchTokens(String(chainId), {
    name: input,
    isWhitelisted: true,
    pageSize: 1,
  });

  if (tokens.length === 0) {
    tokens = await client.searchTokens(String(chainId), {
      name: input,
      pageSize: 5,
    });
  }

  if (tokens.length === 0) {
    throw new EchoError(
      ErrorCodes.KYBER_TOKEN_NOT_FOUND,
      `Token "${input}" not found on chain ${chainId}`,
      "Provide a token address or try a different symbol.",
    );
  }

  return getAddress(tokens[0].address);
}

function pickBestTokenMatch(tokens: KyberToken[], input: string, exactAddress?: Address): KyberToken | null {
  if (tokens.length === 0) return null;

  if (exactAddress) {
    return tokens.find((token) => token.address.toLowerCase() === exactAddress.toLowerCase()) ?? null;
  }

  const lower = input.toLowerCase();
  return tokens.find((token) => token.symbol.toLowerCase() === lower)
    ?? tokens.find((token) => token.name.toLowerCase() === lower)
    ?? tokens[0];
}

/**
 * Resolve a token into metadata required for amount parsing.
 *
 * For native tokens we use the aggregator sentinel address and the standard
 * 18-decimal EVM denomination expected by the API.
 */
export async function resolveTokenMetadata(input: string, chainId: number): Promise<ResolvedKyberTokenMetadata> {
  const lower = input.toLowerCase();

  if (lower === "native" || lower === "eth") {
    return {
      address: NATIVE_TOKEN_ADDRESS,
      symbol: "NATIVE",
      name: "Native token",
      decimals: 18,
      isNative: true,
    };
  }

  // Address input → read metadata directly from chain (authoritative for decimals/symbol/name)
  if (isAddress(input)) {
    const slug = chainIdToSlug(chainId);
    if (!slug) {
      throw new EchoError(
        ErrorCodes.KYBER_TOKEN_NOT_FOUND,
        `Cannot resolve chain slug for chainId ${chainId}`,
      );
    }
    return readErc20Metadata(slug, getAddress(input));
  }

  // Symbol input → Token API search, whitelisted first, then broader fallback
  const client = getKyberTokenApiClient();
  let tokens = await client.searchTokens(String(chainId), {
    name: input,
    isWhitelisted: true,
    pageSize: 10,
  });
  let match = pickBestTokenMatch(tokens, input);

  if (!match) {
    tokens = await client.searchTokens(String(chainId), {
      name: input,
      pageSize: 10,
    });
    match = pickBestTokenMatch(tokens, input);
  }

  if (!match) {
    throw new EchoError(
      ErrorCodes.KYBER_TOKEN_NOT_FOUND,
      `Token "${input}" not found on chain ${chainId}`,
      "Provide a token address or try a different symbol.",
    );
  }

  return {
    address: getAddress(match.address),
    symbol: match.symbol,
    name: match.name,
    decimals: match.decimals,
    isNative: false,
  };
}

/**
 * Strict token metadata resolver — address-only for mutating operations.
 *
 * Rejects symbol/name inputs to prevent ambiguous resolution (e.g. "USDC"
 * resolving to axlUSDC instead of native USDC). Symbols must be resolved
 * via khalani.tokens.search BEFORE calling mutating swap/order tools.
 */
export async function resolveTokenMetadataStrict(input: string, chainId: number): Promise<ResolvedKyberTokenMetadata> {
  const lower = input.toLowerCase();

  if (lower === "native" || lower === "eth") {
    return {
      address: NATIVE_TOKEN_ADDRESS,
      symbol: "NATIVE",
      name: "Native token",
      decimals: 18,
      isNative: true,
    };
  }

  if (!isAddress(input)) {
    throw new EchoError(
      ErrorCodes.KYBER_TOKEN_NOT_FOUND,
      `Token "${input}" is not a valid address. Resolve token addresses via khalani.tokens.search before calling mutating tools.`,
      "Pass the exact contract address, not a symbol or name.",
    );
  }

  const slug = chainIdToSlug(chainId);
  if (!slug) {
    throw new EchoError(
      ErrorCodes.KYBER_TOKEN_NOT_FOUND,
      `Cannot resolve chain slug for chainId ${chainId}`,
    );
  }
  return readErc20Metadata(slug, getAddress(input));
}
