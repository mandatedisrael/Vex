/**
 * Khalani shared helpers — pure domain logic.
 * Extracted from commands/khalani/helpers.ts for retained core.
 */

import { getAddress, isAddress } from "viem";
import { loadConfig } from "../../config/store.js";
import { getPrimaryEvmAddress, getPrimarySolanaAddress } from "../wallet/inventory.js";
import { VexError, ErrorCodes } from "../../errors.js";
import { resolveChainId } from "./chains.js";
import { isSolanaAddressLike } from "./validation.js";
import type { ChainFamily, KhalaniChain } from "./types.js";

export function formatChainFamily(family: ChainFamily): string {
  return family === "solana" ? "Solana" : "EVM";
}

export function normalizeAddressForFamily(address: string, family: ChainFamily, fieldName = "address"): string {
  if (family === "eip155") {
    if (!isAddress(address)) {
      throw new VexError(ErrorCodes.INVALID_ADDRESS, `Invalid EVM ${fieldName}: ${address}`);
    }
    return getAddress(address);
  }

  if (!isSolanaAddressLike(address)) {
    throw new VexError(ErrorCodes.INVALID_ADDRESS, `Invalid Solana ${fieldName}: ${address}`);
  }
  return address;
}

export function resolveConfiguredAddress(family: ChainFamily): string | null {
  const cfg = loadConfig();
  return family === "solana" ? getPrimarySolanaAddress(cfg) : getPrimaryEvmAddress(cfg);
}

export function parseChainIdsOption(value: string | undefined, chains: KhalaniChain[]): number[] | undefined {
  if (!value) return undefined;
  const ids = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolveChainId(entry, chains));
  return ids.length > 0 ? ids : undefined;
}

export function resolveRouteBestIndex(
  routes: Array<{ quote: { amountOut: string; expectedDurationSeconds: number } }>,
): number {
  let bestIndex = 0;
  for (let i = 1; i < routes.length; i++) {
    const currentOut = BigInt(routes[i].quote.amountOut);
    const bestOut = BigInt(routes[bestIndex].quote.amountOut);
    if (currentOut > bestOut) {
      bestIndex = i;
      continue;
    }
    if (currentOut === bestOut && routes[i].quote.expectedDurationSeconds < routes[bestIndex].quote.expectedDurationSeconds) {
      bestIndex = i;
    }
  }
  return bestIndex;
}
