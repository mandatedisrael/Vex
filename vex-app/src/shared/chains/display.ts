/**
 * Chain display metadata — serializable, framework-free so BOTH trust zones
 * can import it: the main process (portfolio-db family derivation) and the
 * renderer (ChainIcon / the POSITION switcher). It deliberately holds NO React
 * or `@thesvg/react` imports — icon COMPONENTS live in the renderer's
 * `ChainIcon.tsx`; this module only names WHICH icon source a chain uses (a
 * verified `@thesvg` key, or a local public-dir asset path for chains the
 * package has no icon for, e.g. Arbitrum).
 *
 * `chain_id` here is the value stored in `proj_balances.chain_id` (BIGINT):
 * canonical EVM chain ids plus Khalani's synthetic Solana id. The map is a
 * small hardcoded allow-list; unknown ids fall back to a neutral display so
 * the UI never blanks.
 */

export type ChainFamily = "evm" | "solana";

/** Khalani's synthetic Solana chain id as it appears in `proj_balances`. */
export const SOLANA_CHAIN_ID = 20011000000;

/** Canonical EVM chain ids referenced by the deposit view / quick switcher. */
export const ETHEREUM_CHAIN_ID = 1;
export const BASE_CHAIN_ID = 8453;
export const ARBITRUM_CHAIN_ID = 42161;
export const ROBINHOOD_CHAIN_ID = 4663;

/**
 * Family a chain id belongs to. The single Solana id is the only non-EVM
 * value in `proj_balances`; everything else is an EVM chain. Kept here so the
 * main-process breakdown query and the renderer agree on one derivation.
 */
export function familyForChainId(chainId: number): ChainFamily {
  return chainId === SOLANA_CHAIN_ID ? "solana" : "evm";
}

/** `@thesvg/react` icon keys VERIFIED present in the installed package. */
export type ChainSvgKey =
  | "ethereum"
  | "solana"
  | "robinhood"
  | "polygon"
  | "optimism"
  | "bnb-chain";

/**
 * Where a chain's icon comes from:
 *  - `thesvg` — a key resolved to a `@thesvg/react` component in ChainIcon;
 *  - `asset`  — a path under the renderer publicDir (Arbitrum: `@thesvg` has
 *    no arbitrum icon, so a local SVG is shipped instead);
 *  - `fallback` — unknown chain → ChainIcon draws a neutral monogram.
 */
export type ChainIconSource =
  | { readonly kind: "thesvg"; readonly key: ChainSvgKey }
  | { readonly kind: "asset"; readonly src: string }
  | { readonly kind: "fallback" };

export interface ChainDisplay {
  readonly chainId: number;
  readonly name: string;
  readonly family: ChainFamily;
  readonly icon: ChainIconSource;
}

const CHAIN_DISPLAY: Readonly<Record<number, ChainDisplay>> = {
  [ETHEREUM_CHAIN_ID]: {
    chainId: ETHEREUM_CHAIN_ID,
    name: "Ethereum",
    family: "evm",
    icon: { kind: "thesvg", key: "ethereum" },
  },
  [ROBINHOOD_CHAIN_ID]: {
    chainId: ROBINHOOD_CHAIN_ID,
    name: "Robinhood",
    family: "evm",
    icon: { kind: "thesvg", key: "robinhood" },
  },
  [BASE_CHAIN_ID]: {
    chainId: BASE_CHAIN_ID,
    name: "Base",
    family: "evm",
    // The `@thesvg` base icon proved unreliable across versions (2.1.x paints
    // nothing; 3.x is currentColor-keyed) — ship the official mark as a local
    // asset with a hardcoded brand fill, like Arbitrum.
    icon: { kind: "asset", src: "/logo/base.svg" },
  },
  [ARBITRUM_CHAIN_ID]: {
    chainId: ARBITRUM_CHAIN_ID,
    name: "Arbitrum",
    family: "evm",
    // No `@thesvg` arbitrum icon — ship the mark as a local public asset.
    icon: { kind: "asset", src: "/logo/arbitrum.svg" },
  },
  137: {
    chainId: 137,
    name: "Polygon",
    family: "evm",
    icon: { kind: "thesvg", key: "polygon" },
  },
  10: {
    chainId: 10,
    name: "Optimism",
    family: "evm",
    icon: { kind: "thesvg", key: "optimism" },
  },
  56: {
    chainId: 56,
    name: "BNB Chain",
    family: "evm",
    icon: { kind: "thesvg", key: "bnb-chain" },
  },
  [SOLANA_CHAIN_ID]: {
    chainId: SOLANA_CHAIN_ID,
    name: "Solana",
    family: "solana",
    icon: { kind: "thesvg", key: "solana" },
  },
};

/**
 * Display record for a chain id. Known ids return their curated entry; an
 * unknown id gets a neutral `Chain <id>` label + monogram fallback so the
 * switcher and headers never blank on a chain we haven't catalogued.
 */
export function chainDisplay(chainId: number): ChainDisplay {
  const known = CHAIN_DISPLAY[chainId];
  if (known !== undefined) return known;
  return {
    chainId,
    name: `Chain ${chainId}`,
    family: familyForChainId(chainId),
    icon: { kind: "fallback" },
  };
}

/**
 * EVM quick-switch chips, in render order. Ethereum leads as the always-present
 * default; the rest are the product's promoted networks. Chains with a balance
 * outside this set are reachable through the "see more" dialog.
 */
export const EVM_QUICK_CHAIN_IDS: readonly number[] = [
  ETHEREUM_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
  BASE_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
];

/** Default EVM selection — ALWAYS Ethereum, even at zero balance. */
export const DEFAULT_EVM_CHAIN_ID = ETHEREUM_CHAIN_ID;
