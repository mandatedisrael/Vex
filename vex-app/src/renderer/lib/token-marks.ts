/**
 * Verified token-mark resolver — chain-aware brand-icon authorization for
 * every BOOK token row (PositionChains today; BalancesCard/AssetsScreen are
 * later consumers of the same contract). Supersedes the single-chain
 * `verifiedBrandTicker`/`KNOWN_SOLANA_MINTS` that used to live inline in
 * `PositionChains.tsx`: identity is now keyed on `(chainId, normalized
 * tokenAddress)`, so the SAME contract address on the WRONG chain, or the
 * WRONG on-chain symbol at the RIGHT address, both correctly fail the brand
 * check instead of silently matching.
 *
 * Identity key: `(chainId, normalized tokenAddress)`.
 *  - EVM addresses are lowercase-normalized (checksum casing is cosmetic —
 *    the same contract, differently cased).
 *  - Solana base58 mint addresses are case-SENSITIVE and are NEVER
 *    lowercased — a differently-cased Solana address is a DIFFERENT address,
 *    not the same mint with different casing.
 *
 * A brand mark is granted ONLY when BOTH the `(chainId, address)` row
 * matches AND the row's expected on-chain symbol equals the CALLER's
 * sanitized symbol, case-insensitively. This means a same-address token that
 * changed its on-chain symbol (see the USDT0-migration rows below) correctly
 * LOSES its brand mark rather than keep wearing a stale one — intended
 * conservative behavior, not a bug.
 *
 * Every row below is independently verified against an official issuer or
 * chain source; the source URL and verification date are recorded per row.
 * A row that fails verification is DROPPED, not adjusted. Genuine assets
 * outside this matrix correctly receive the family fallback — the guarantee
 * is "every row in this matrix is address-correct", not "every genuine
 * token gets a brand mark".
 *
 * Family fallback (evm → Ethereum mark, solana → Solana mark) is the
 * default for every unverified or unmatched holding — the SAME family mark
 * PositionChains, BalancesCard, and AssetsScreen all show for a
 * genuine-but-uncatalogued asset (deliberate consistency, not an oversight).
 * Monogram is reserved for a genuinely unknown family — `chainId: null`
 * (no chain to resolve a family from at all). Every real `proj_balances`
 * chain id resolves to "evm" or "solana" via `familyForChainId`, so `null`
 * is the only input that reaches the monogram branch in practice.
 */

import {
  Bitcoin,
  Bnb,
  Chainlink,
  DaiStablecoin,
  Ethereum,
  Polygon,
  Solana,
  Tether,
  Usdc,
} from "@thesvg/react";
import type { ComponentType } from "react";
import {
  familyForChainId,
  SOLANA_CHAIN_ID,
  type ChainFamily,
} from "@shared/chains/display.js";
import { sanitizeTokenSymbol } from "@shared/token-symbol-sanitizer.js";

/**
 * The call surface `TokenMark` actually uses. `@thesvg/react` gives every
 * icon its OWN props type (`EthereumProps`, `BnbProps`, …), so `typeof
 * Ethereum` cannot hold the others — this minimal structural type accepts
 * any of them without an unsafe cast.
 */
type BrandIcon = ComponentType<{
  readonly width?: number | string;
  readonly height?: number | string;
  readonly className?: string;
  readonly "aria-hidden"?: boolean;
  readonly focusable?: boolean;
}>;

/** A resolvable mark: a `@thesvg/react` brand component, or a bundled local
 * asset path for a mark the package doesn't carry (Jupiter). */
type MarkEntry =
  | { readonly kind: "brand"; readonly icon: BrandIcon }
  | { readonly kind: "local"; readonly src: string };

/**
 * What a caller should render for one token line. `family`/`monogram` are
 * EXPLICIT variants — never faked by inventing an "ETH"/"SOL" symbol — so
 * the rendering layer can tell "verified brand" apart from "familiar chain,
 * unverified token" apart from "nothing resolvable at all".
 */
export type TokenMarkResolution =
  | MarkEntry
  | { readonly kind: "family"; readonly family: ChainFamily }
  | { readonly kind: "monogram" };

interface VerifiedRow {
  readonly chainId: number;
  /** Already in the row's canonical comparison form: lowercase for EVM,
   * verbatim base58 for Solana. */
  readonly address: string;
  /** Expected on-chain symbol, compared case-insensitively against the
   * caller's SANITIZED symbol — never the raw/unsanitized one. */
  readonly symbol: string;
  readonly mark: MarkEntry;
}

// The EVM native-gas placeholder (`NATIVE_TOKEN_ADDRESS` in
// `src/tools/kyberswap/constants.ts`) — not a deployable contract address,
// so no token can ever spoof it. Lower-cased for comparison: EVM checksum
// casing is cosmetic, unlike Solana base58.
const NATIVE_EVM_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/**
 * Native-gas mark per EVM chain id — keyed on chain id alone (the sentinel
 * address is unspoofable by construction, so no symbol check is needed
 * here, unlike the verified contract-address rows below). Chains without an
 * entry (including Robinhood 4663 — no root chain-registry import allowed
 * across the renderer boundary) fall through to the family mark.
 */
const NATIVE_MARK_BY_CHAIN_ID: Readonly<Record<number, MarkEntry>> = {
  1: { kind: "brand", icon: Ethereum },
  10: { kind: "brand", icon: Ethereum },
  8453: { kind: "brand", icon: Ethereum },
  42161: { kind: "brand", icon: Ethereum },
  137: { kind: "brand", icon: Polygon },
  56: { kind: "brand", icon: Bnb },
};

/**
 * Verified EVM rows. Addresses are LOWERCASE (the identity key's canonical
 * EVM comparison form). Every row: source URL + verification date.
 */
const EVM_VERIFIED_ROWS: readonly VerifiedRow[] = [
  // WETH — canonical mainnet WETH9.
  // https://etherscan.io/token/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 — verified 2026-07-20.
  {
    chainId: 1,
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    symbol: "WETH",
    mark: { kind: "brand", icon: Ethereum },
  },
  // WETH — OP-stack canonical predeploy (shared address on every OP-stack chain).
  // https://specs.optimism.io/protocol/predeploys.html — verified 2026-07-20.
  {
    chainId: 10,
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    mark: { kind: "brand", icon: Ethereum },
  },
  // WETH — same OP-stack predeploy, on Base.
  // https://basescan.org/token/0x4200000000000000000000000000000000000006 — verified 2026-07-20.
  {
    chainId: 8453,
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    mark: { kind: "brand", icon: Ethereum },
  },
  // WETH — Arbitrum canonical bridge WETH.
  // https://arbiscan.io/token/0x82af49447d8a07e3bd95bd0d56f35241523fbab1 — verified 2026-07-20.
  {
    chainId: 42161,
    address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    symbol: "WETH",
    mark: { kind: "brand", icon: Ethereum },
  },
  // USDC — mainnet.
  // https://developers.circle.com/stablecoins/usdc-contract-addresses — verified 2026-07-20.
  {
    chainId: 1,
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    symbol: "USDC",
    mark: { kind: "brand", icon: Usdc },
  },
  // USDC — Base (Circle-native).
  // https://developers.circle.com/stablecoins/usdc-contract-addresses — verified 2026-07-20.
  {
    chainId: 8453,
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    mark: { kind: "brand", icon: Usdc },
  },
  // USDC — Arbitrum (Circle-native).
  // https://developers.circle.com/stablecoins/usdc-contract-addresses — verified 2026-07-20.
  {
    chainId: 42161,
    address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    symbol: "USDC",
    mark: { kind: "brand", icon: Usdc },
  },
  // USDC — Optimism (Circle-native).
  // https://developers.circle.com/stablecoins/usdc-contract-addresses — verified 2026-07-20.
  {
    chainId: 10,
    address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    symbol: "USDC",
    mark: { kind: "brand", icon: Usdc },
  },
  // USDC — Polygon (Circle-native).
  // https://developers.circle.com/stablecoins/usdc-contract-addresses — verified 2026-07-20.
  {
    chainId: 137,
    address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    symbol: "USDC",
    mark: { kind: "brand", icon: Usdc },
  },
  // USDT — mainnet.
  // https://tether.to/en/supported-protocols — verified 2026-07-20.
  {
    chainId: 1,
    address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    symbol: "USDT",
    mark: { kind: "brand", icon: Tether },
  },
  // USDT — Arbitrum. NOTE: post-USDT0-migration the on-chain symbol reads
  // "USD₮0" (non-ASCII), which `sanitizeTokenSymbol` rejects to `null` — this
  // row simply will not fire a brand match at runtime for that new symbol.
  // That is INTENTIONAL conservative behavior (never widen the symbol gate
  // to chase a rename), not a bug; kept for the historical/legacy "USDT" case.
  // https://arbiscan.io/token/0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 — verified 2026-07-20.
  {
    chainId: 42161,
    address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
    symbol: "USDT",
    mark: { kind: "brand", icon: Tether },
  },
  // USDT — Optimism (bridged).
  // https://optimistic.etherscan.io/token/0x94b008aa00579c1307b0ef2c499ad98a8ce58e58 — verified 2026-07-20.
  {
    chainId: 10,
    address: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
    symbol: "USDT",
    mark: { kind: "brand", icon: Tether },
  },
  // USDT — Polygon. Same USDT0-migration note as Arbitrum above.
  // https://polygonscan.com/token/0xc2132d05d31c914a87c6611c10748aeb04b58e8f — verified 2026-07-20.
  {
    chainId: 137,
    address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    symbol: "USDT",
    mark: { kind: "brand", icon: Tether },
  },
  // WBTC — mainnet.
  // https://etherscan.io/token/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599 — verified 2026-07-20.
  {
    chainId: 1,
    address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    symbol: "WBTC",
    mark: { kind: "brand", icon: Bitcoin },
  },
  // WBTC — Arbitrum.
  // https://arbiscan.io/token/0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f — verified 2026-07-20.
  {
    chainId: 42161,
    address: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f",
    symbol: "WBTC",
    mark: { kind: "brand", icon: Bitcoin },
  },
  // LINK — mainnet.
  // https://docs.chain.link/resources/link-token-contracts — verified 2026-07-20.
  {
    chainId: 1,
    address: "0x514910771af9ca656af840dff83e8264ecf986ca",
    symbol: "LINK",
    mark: { kind: "brand", icon: Chainlink },
  },
  // WBNB — BNB Chain.
  // https://bscscan.com/token/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c — verified 2026-07-20.
  {
    chainId: 56,
    address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    symbol: "WBNB",
    mark: { kind: "brand", icon: Bnb },
  },
  // DAI — mainnet (v1: mainnet only; bridged DAI rows deferred).
  // https://docs.makerdao.com/smart-contract-modules/dai-module/dai-detailed-documentation — verified 2026-07-20.
  {
    chainId: 1,
    address: "0x6b175474e89094c44da98b954eedeac495271d0f",
    symbol: "DAI",
    mark: { kind: "brand", icon: DaiStablecoin },
  },
];

/**
 * DELIBERATELY EXCLUDED from the verified matrix (documented, not an
 * oversight):
 *  - BSC `0x55d398326f99059ff775485246999027b3197955` — "Binance-Peg
 *    BSC-USD". NOT Tether-issued (18 decimals, on-chain symbol `BSC-USD`);
 *    badging it with the Tether mark would be a branding decision, deferred
 *    to the product owner.
 *  - VEX / VIRTUAL / USDG on Robinhood chain 4663 — the only address
 *    constants live in root `src/tools/evm-chains/registry.ts`, which the
 *    renderer cannot import (`check:boundaries` process-boundary gate).
 *    Deferred; these show the family (Ethereum) mark until a boundary-safe
 *    verified constant (or a DTO-carried verification flag) exists.
 */

/**
 * Verified Solana rows. Addresses are the EXACT base58 mint strings — never
 * lowercased or otherwise normalized (a differently-cased string is a
 * different address on Solana).
 */
const SOLANA_VERIFIED_ROWS: readonly VerifiedRow[] = [
  // SOL — native mint placeholder.
  // https://spl.solana.com/token — verified 2026-07-20.
  {
    chainId: SOLANA_CHAIN_ID,
    address: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    mark: { kind: "brand", icon: Solana },
  },
  // USDC — Circle-native Solana mint.
  // https://developers.circle.com/stablecoins/usdc-contract-addresses — verified 2026-07-20.
  {
    chainId: SOLANA_CHAIN_ID,
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    mark: { kind: "brand", icon: Usdc },
  },
  // USDT — Tether Solana mint.
  // https://tether.to/en/supported-protocols — verified 2026-07-20.
  {
    chainId: SOLANA_CHAIN_ID,
    address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    symbol: "USDT",
    mark: { kind: "brand", icon: Tether },
  },
  // JUP — Jupiter governance token. No `@thesvg` mark; bundled local asset
  // (offline, same-origin — no remote logo fetch).
  // https://developers.jup.ag/docs — verified 2026-07-20.
  {
    chainId: SOLANA_CHAIN_ID,
    address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    symbol: "JUP",
    mark: { kind: "local", src: "/logo/jupiter.png" },
  },
];

function findVerifiedRow(
  rows: readonly VerifiedRow[],
  chainId: number,
  address: string,
  sanitizedSymbol: string | null,
): MarkEntry | null {
  if (sanitizedSymbol === null) return null;
  const row = rows.find((r) => r.chainId === chainId && r.address === address);
  if (row === undefined) return null;
  return row.symbol.toLowerCase() === sanitizedSymbol.toLowerCase()
    ? row.mark
    : null;
}

/**
 * Resolve the visual mark for one token line. `chainId: null` means the
 * caller has no chain to derive a family from at all (an unresolvable DTO
 * line) and always yields the monogram — every REAL chain id resolves to a
 * known family via `familyForChainId`, so that is the only path here that
 * does not.
 */
export function resolveTokenMark(
  chainId: number | null,
  tokenAddress: string | null,
  symbol: string | null,
): TokenMarkResolution {
  if (chainId === null) return { kind: "monogram" };

  const family = familyForChainId(chainId);
  const sanitizedSymbol = sanitizeTokenSymbol(symbol);

  if (tokenAddress !== null) {
    if (family === "evm") {
      const normalized = tokenAddress.toLowerCase();
      if (normalized === NATIVE_EVM_SENTINEL) {
        const nativeMark = NATIVE_MARK_BY_CHAIN_ID[chainId];
        if (nativeMark !== undefined) return nativeMark;
      } else {
        const mark = findVerifiedRow(
          EVM_VERIFIED_ROWS,
          chainId,
          normalized,
          sanitizedSymbol,
        );
        if (mark !== null) return mark;
      }
    } else {
      // Solana: NEVER normalize case — a case-variant mint is a different address.
      const mark = findVerifiedRow(
        SOLANA_VERIFIED_ROWS,
        chainId,
        tokenAddress,
        sanitizedSymbol,
      );
      if (mark !== null) return mark;
    }
  }

  return { kind: "family", family };
}
