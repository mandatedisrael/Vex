/**
 * ETH-equivalent bankroll read for the mission results ledger.
 *
 * The bankroll is native ETH + WETH (they are 1:1 and price rides on
 * wrapped native). WETH is matched by the chain's registered contract
 * ADDRESS (`tools/evm-chains/registry.ts` seed tokens), never by symbol —
 * a fake/spoofed token whose reported symbol happens to be "WETH" must
 * never inflate the bankroll or hide as an open position.
 *
 * Every other held token is an OPEN position: reported separately and
 * EXCLUDED from the bankroll so an unsold bag never distorts a mission's
 * PnL. Reads the `proj_balances` projection (no on-chain RPC) and is
 * fail-soft — a read error yields null so mission finalization is never
 * blocked by bankroll accounting.
 */

import { formatUnits } from "viem";
import { getBalances } from "../../db/repos/balances/read.js";
import type { BalanceRow } from "../../db/repos/balances/types.js";
import { NATIVE_TOKEN_ADDRESS } from "../../../tools/kyberswap/constants.js";
import { getLocalChain } from "../../../tools/evm-chains/registry.js";
import logger from "@utils/logger.js";

export interface OpenPosition {
  symbol: string | null;
  address: string;
  amount: number;
  valueUsd: number | null;
}

export interface EthBankroll {
  /** Native ETH + WETH, in ETH. */
  bankrollEth: number;
  /** ETH/USD from the native/WETH row (display tooltip only); null if unpriced. */
  ethPriceUsd: number | null;
  /** Non-ETH tokens still held, excluded from the bankroll. */
  openPositions: OpenPosition[];
}

function toAmount(raw: string, decimals: number | null): number {
  try {
    return Number(formatUnits(BigInt(raw), decimals ?? 18));
  } catch {
    return 0;
  }
}

/**
 * The chain's registered WETH contract address (lowercased), or null when
 * the chain isn't in the local registry or has no WETH seed token. Matching
 * by ADDRESS — not the row's self-reported `tokenSymbol` — is the point:
 * a balance row can claim any symbol string, but the contract address at a
 * given chain id is the registry's own provenance-checked data.
 */
function resolveWethAddress(chainId: number): string | null {
  const chain = getLocalChain(chainId);
  const weth = chain?.seedTokens.find((t) => t.label === "WETH");
  return weth ? weth.address.toLowerCase() : null;
}

/** Pure: fold proj_balances rows for one chain into an ETH bankroll + open-position list. */
export function computeEthBankroll(rows: readonly BalanceRow[], chainId: number): EthBankroll {
  const wethAddress = resolveWethAddress(chainId);
  let bankrollEth = 0;
  let ethPriceUsd: number | null = null;
  const openPositions: OpenPosition[] = [];

  for (const r of rows) {
    const tokenAddress = r.tokenAddress.toLowerCase();
    const isNative = tokenAddress === NATIVE_TOKEN_ADDRESS.toLowerCase();
    const isWeth = wethAddress !== null && tokenAddress === wethAddress;
    const amount = toAmount(r.balanceRaw, r.decimals);

    if (isNative || isWeth) {
      bankrollEth += amount;
      if (ethPriceUsd === null && r.priceUsd !== null) ethPriceUsd = r.priceUsd;
    } else if (amount > 0) {
      openPositions.push({
        symbol: r.tokenSymbol,
        address: r.tokenAddress,
        amount,
        valueUsd: r.balanceUsd,
      });
    }
  }

  return { bankrollEth, ethPriceUsd, openPositions };
}

export interface BankrollDeps {
  getBalances: typeof getBalances;
}

/**
 * Read the wallet's ETH bankroll on a chain from `proj_balances`. Fail-soft:
 * returns null on any read error (caller records a null snapshot rather
 * than failing the run). Never logs the wallet address.
 */
export async function readEthBankroll(
  walletAddress: string,
  chainId: number,
  deps: BankrollDeps = { getBalances },
): Promise<EthBankroll | null> {
  try {
    const rows = await deps.getBalances(walletAddress, chainId);
    return computeEthBankroll(rows, chainId);
  } catch (err) {
    logger.warn("mission.results.bankroll_read_failed", {
      chainId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
