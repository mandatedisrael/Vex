/**
 * Pendle v2 (Ethereum mainnet) — pinned addresses, method selectors, and the
 * fund-safety constants every broadcast is checked against.
 *
 * Pendle is Ethereum-v1-only in this wave. The Router is the SINGLE canonical
 * on-chain target: every mutating broadcast asserts `tx.to === PENDLE_ROUTER`
 * (checksummed) and rejects otherwise. `requiredApprovals` from the hosted
 * Convert API carry NO spender field — the spender is IMPLICITLY the Router, so
 * approvals are ALWAYS granted to the pinned Router for the EXACT amount.
 *
 * The four Router methods below are the ONLY selectors a Pendle broadcast may
 * carry. The intent-binding check (see protocols/pendle/calldata.ts) FULL-decodes
 * `tx.data` against `PENDLE_ROUTER_ABI` and asserts receiver == session wallet,
 * market/YT == the quoted market/YT, and the ACTUAL spend token/amount inside the
 * TokenInput/TokenOutput tuples == the quoted intent.
 */

import { getAddress, type Address } from "viem";

/** Pendle v2 Router (Ethereum mainnet). Checksummed; every broadcast pins tx.to here. */
export const PENDLE_ROUTER: Address = getAddress("0x888888888889758F76e7103c6CbF23ABbF58F946");

/** Native-token sentinel (Convert uses the zero address for native ETH input). */
export const PENDLE_NATIVE_TOKEN: Address = getAddress("0x0000000000000000000000000000000000000000");

/** Pendle is Ethereum-mainnet only in this wave. */
export const PENDLE_CHAIN_ID = 1;

/**
 * Default Ethereum mainnet RPC for keyless quoting / broadcast / balance reads.
 * A public, key-less endpoint (same provider family the other venues default to);
 * a user override can be threaded via config in a later wave if needed.
 */
export const PENDLE_ETHEREUM_RPC_URL = "https://ethereum-rpc.publicnode.com";

/**
 * Aggregators Convert is allowed to route through. Restricting to these two keeps
 * the compute-unit spend bounded (convert = 5 base + 1 per aggregator) and the
 * broadcast surface to venues we have verified. Order is not significant.
 */
export const PENDLE_AGGREGATORS = ["kyberswap", "okx"] as const;

/**
 * Router method selectors (4-byte), pinned for documentation/audit. These are
 * the ONLY methods a Pendle broadcast may carry:
 *   - swapExactTokenForPt : token → PT (buy)
 *   - swapExactPtForToken : PT → token (early-exit sell)
 *   - redeemPyToToken     : PT → underlying (redeem)
 *   - redeemPyToSy        : PT → SY (redeem fallback)
 * The fund-safety extractor decodes against the FULL `PENDLE_ROUTER_ABI` below
 * (whose computed selectors are test-pinned to these values via live calldata).
 */
export const PENDLE_SELECTORS = {
  swapExactTokenForPt: "0xc81f847a",
  swapExactPtForToken: "0x594a88cc",
  redeemPyToToken: "0x47f1de22",
  redeemPyToSy: "0x339748cb",
} as const;

export type PendleRouterMethod = keyof typeof PENDLE_SELECTORS;

/** selector (lowercase 0x-hex) → method name, for the calldata head decoder. */
export const PENDLE_SELECTOR_TO_METHOD: Readonly<Record<string, PendleRouterMethod>> = {
  [PENDLE_SELECTORS.swapExactTokenForPt]: "swapExactTokenForPt",
  [PENDLE_SELECTORS.swapExactPtForToken]: "swapExactPtForToken",
  [PENDLE_SELECTORS.redeemPyToToken]: "redeemPyToToken",
  [PENDLE_SELECTORS.redeemPyToSy]: "redeemPyToSy",
};

// ── Full Router ABI (the four allowed methods; structs from IPAllActionTypeV3) ──
//
// The fund-safety extractor FULL-decodes every broadcast against this ABI (Codex
// fix: the static head alone never bound the ACTUAL spend token/amount inside the
// dynamic TokenInput/TokenOutput tuples). Selector correctness is pinned by tests
// that decode LIVE-probed calldata — a wrong struct layout changes the selector
// and fails to decode.

const APPROX_PARAMS_COMPONENTS = [
  { name: "guessMin", type: "uint256" },
  { name: "guessMax", type: "uint256" },
  { name: "guessOffchain", type: "uint256" },
  { name: "maxIteration", type: "uint256" },
  { name: "eps", type: "uint256" },
] as const;

const SWAP_DATA_COMPONENTS = [
  { name: "swapType", type: "uint8" },
  { name: "extRouter", type: "address" },
  { name: "extCalldata", type: "bytes" },
  { name: "needScale", type: "bool" },
] as const;

const TOKEN_INPUT_COMPONENTS = [
  { name: "tokenIn", type: "address" },
  { name: "netTokenIn", type: "uint256" },
  { name: "tokenMintSy", type: "address" },
  { name: "pendleSwap", type: "address" },
  { name: "swapData", type: "tuple", components: SWAP_DATA_COMPONENTS },
] as const;

const TOKEN_OUTPUT_COMPONENTS = [
  { name: "tokenOut", type: "address" },
  { name: "minTokenOut", type: "uint256" },
  { name: "tokenRedeemSy", type: "address" },
  { name: "pendleSwap", type: "address" },
  { name: "swapData", type: "tuple", components: SWAP_DATA_COMPONENTS },
] as const;

const ORDER_COMPONENTS = [
  { name: "salt", type: "uint256" },
  { name: "expiry", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "orderType", type: "uint8" },
  { name: "token", type: "address" },
  { name: "YT", type: "address" },
  { name: "maker", type: "address" },
  { name: "receiver", type: "address" },
  { name: "makingAmount", type: "uint256" },
  { name: "lnImpliedRate", type: "uint256" },
  { name: "failSafeRate", type: "uint256" },
  { name: "permit", type: "bytes" },
] as const;

const FILL_ORDER_PARAMS_COMPONENTS = [
  { name: "order", type: "tuple", components: ORDER_COMPONENTS },
  { name: "signature", type: "bytes" },
  { name: "makingAmount", type: "uint256" },
] as const;

const LIMIT_ORDER_DATA_COMPONENTS = [
  { name: "limitRouter", type: "address" },
  { name: "epsSkipMarket", type: "uint256" },
  { name: "normalFills", type: "tuple[]", components: FILL_ORDER_PARAMS_COMPONENTS },
  { name: "flashFills", type: "tuple[]", components: FILL_ORDER_PARAMS_COMPONENTS },
  { name: "optData", type: "bytes" },
] as const;

export const PENDLE_ROUTER_ABI = [
  {
    type: "function",
    name: "swapExactTokenForPt",
    stateMutability: "payable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "market", type: "address" },
      { name: "minPtOut", type: "uint256" },
      { name: "guessPtOut", type: "tuple", components: APPROX_PARAMS_COMPONENTS },
      { name: "input", type: "tuple", components: TOKEN_INPUT_COMPONENTS },
      { name: "limit", type: "tuple", components: LIMIT_ORDER_DATA_COMPONENTS },
    ],
    outputs: [
      { name: "netPtOut", type: "uint256" },
      { name: "netSyFee", type: "uint256" },
      { name: "netSyInterm", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "swapExactPtForToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "market", type: "address" },
      { name: "exactPtIn", type: "uint256" },
      { name: "output", type: "tuple", components: TOKEN_OUTPUT_COMPONENTS },
      { name: "limit", type: "tuple", components: LIMIT_ORDER_DATA_COMPONENTS },
    ],
    outputs: [
      { name: "netTokenOut", type: "uint256" },
      { name: "netSyFee", type: "uint256" },
      { name: "netSyInterm", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "redeemPyToToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "YT", type: "address" },
      { name: "netPyIn", type: "uint256" },
      { name: "output", type: "tuple", components: TOKEN_OUTPUT_COMPONENTS },
    ],
    outputs: [
      { name: "netTokenOut", type: "uint256" },
      { name: "netSyInterm", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "redeemPyToSy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "YT", type: "address" },
      { name: "netPyIn", type: "uint256" },
      { name: "minSyOut", type: "uint256" },
    ],
    outputs: [{ name: "netSyOut", type: "uint256" }],
  },
] as const;

/**
 * Minimal Router ABI for the API-independent redeem fallback
 * (`redeemPyToSy(receiver, YT, netPyIn, minSyOut)` from IPActionMiscV3). The
 * always-exit path when the Convert API is unavailable for a MATURED position.
 */
export const PENDLE_ROUTER_REDEEM_ABI = [
  {
    type: "function",
    name: "redeemPyToSy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "YT", type: "address" },
      { name: "netPyIn", type: "uint256" },
      { name: "minSyOut", type: "uint256" },
    ],
    outputs: [{ name: "netSyOut", type: "uint256" }],
  },
] as const;

/** ERC-20 read/approve ABI (balanceOf / decimals / symbol / allowance / approve). */
export const PENDLE_ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** Pendle-known category id that marks a points program (not fixed yield). */
export const PENDLE_POINTS_CATEGORY = "points";

/** Below this implied APY a points-bearing market's headline yield is misleading. */
export const PENDLE_LOW_APY_THRESHOLD = 0.03;
