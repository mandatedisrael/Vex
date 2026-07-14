/**
 * ETH-equivalent bankroll from proj_balances rows. Native ETH + WETH (WETH
 * matched by the chain's registered contract ADDRESS, never by symbol) make
 * up the bankroll; every other held token is an OPEN position, reported
 * separately and excluded from the bankroll figure so an unsold bag never
 * inflates PnL.
 */

import { describe, it, expect } from "vitest";
import { computeEthBankroll } from "../../../../vex-agent/engine/mission/bankroll.js";
import type { BalanceRow } from "../../../../vex-agent/db/repos/balances/types.js";

const ROBINHOOD_CHAIN_ID = 4663;
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
// Real WETH address on Robinhood Chain (tools/evm-chains/registry.ts seedTokens).
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

function bal(over: Partial<BalanceRow>): BalanceRow {
  return {
    walletFamily: "eip155", walletAddress: "0xW", chainId: ROBINHOOD_CHAIN_ID,
    tokenAddress: NATIVE, tokenSymbol: "ETH", tokenName: "Ether",
    balanceRaw: "0", balanceUsd: null, priceUsd: null, decimals: 18, ...over,
  };
}

describe("computeEthBankroll", () => {
  it("sums native ETH + WETH into the bankroll", () => {
    const r = computeEthBankroll([
      bal({ tokenAddress: NATIVE, tokenSymbol: "ETH", balanceRaw: "10000000000000000", priceUsd: 3000 }), // 0.01
      bal({ tokenAddress: WETH, tokenSymbol: "WETH", balanceRaw: "5000000000000000", priceUsd: 3000 }), // 0.005
    ], ROBINHOOD_CHAIN_ID);
    expect(r.bankrollEth).toBeCloseTo(0.015, 12);
    expect(r.ethPriceUsd).toBe(3000);
    expect(r.openPositions).toHaveLength(0);
  });

  it("matches WETH by ADDRESS, not by a row's self-reported symbol", () => {
    // Regression: a token whose SYMBOL happens to be "WETH" but whose
    // ADDRESS is not the chain's registered WETH contract must be treated
    // as an open position, not folded into the bankroll (symbol strings are
    // untrusted / spoofable; the registry address is provenance-checked).
    const r = computeEthBankroll([
      bal({ tokenAddress: NATIVE, tokenSymbol: "ETH", balanceRaw: "10000000000000000", priceUsd: 3000 }),
      bal({ tokenAddress: "0xFakeWethAddress0000000000000000000000", tokenSymbol: "WETH", balanceRaw: "5000000000000000", balanceUsd: 15 }),
    ], ROBINHOOD_CHAIN_ID);
    expect(r.bankrollEth).toBeCloseTo(0.01, 12);
    expect(r.openPositions).toHaveLength(1);
    expect(r.openPositions[0]).toMatchObject({ symbol: "WETH", address: "0xFakeWethAddress0000000000000000000000" });
  });

  it("treats other tokens as open positions, excluded from the bankroll", () => {
    const r = computeEthBankroll([
      bal({ tokenAddress: NATIVE, tokenSymbol: "ETH", balanceRaw: "10000000000000000", priceUsd: 3000 }),
      bal({ tokenAddress: "0xNOXA", tokenSymbol: "NOXA", balanceRaw: "2000000000000000000", decimals: 18, balanceUsd: 42 }),
    ], ROBINHOOD_CHAIN_ID);
    expect(r.bankrollEth).toBeCloseTo(0.01, 12); // NOXA excluded
    expect(r.openPositions).toHaveLength(1);
    expect(r.openPositions[0]).toMatchObject({ symbol: "NOXA", address: "0xNOXA", valueUsd: 42 });
    expect(r.openPositions[0]!.amount).toBeCloseTo(2, 9);
  });

  it("ignores zero-balance non-ETH tokens (dust rows)", () => {
    const r = computeEthBankroll([
      bal({ tokenAddress: NATIVE, balanceRaw: "10000000000000000", priceUsd: 3000 }),
      bal({ tokenAddress: "0xDUST", tokenSymbol: "DUST", balanceRaw: "0" }),
    ], ROBINHOOD_CHAIN_ID);
    expect(r.openPositions).toHaveLength(0);
  });

  it("returns a zero bankroll for no rows", () => {
    const r = computeEthBankroll([], ROBINHOOD_CHAIN_ID);
    expect(r.bankrollEth).toBe(0);
    expect(r.ethPriceUsd).toBeNull();
  });

  it("treats WETH as an open position on a chain with no registered WETH (unknown chain id)", () => {
    const r = computeEthBankroll([
      bal({ tokenAddress: NATIVE, balanceRaw: "10000000000000000", priceUsd: 3000, chainId: 999999 }),
      bal({ tokenAddress: WETH, tokenSymbol: "WETH", balanceRaw: "5000000000000000", balanceUsd: 15, chainId: 999999 }),
    ], 999999);
    expect(r.bankrollEth).toBeCloseTo(0.01, 12);
    expect(r.openPositions).toHaveLength(1);
  });
});
