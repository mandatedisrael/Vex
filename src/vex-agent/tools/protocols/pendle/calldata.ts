/**
 * Pendle broadcast fund-safety extractor (LOCKED G2#1 — calldata intent binding,
 * FULL ABI decode per Codex final review).
 *
 * Before ANY Pendle broadcast, the chosen Convert route is validated against the
 * caller's intent. Nothing is signed unless EVERY check passes; a failure throws
 * `PENDLE_UNSAFE_TX` (our own fixed text — the upstream body never leaks here).
 *
 * Checks (fail → ZERO approve, ZERO send):
 *   1. Router pin       : tx.to === PENDLE_ROUTER (checksummed).
 *   2. Sender bind      : tx.from absent OR equals the session wallet.
 *   3. Value bind       : tx.value present+non-zero ONLY for native input; the
 *                         value must equal the input amount. Non-native → absent/0.
 *   4. Approvals bind   : requiredApprovals EXACTLY match the expected set and
 *                         contain NOTHING else — buy/sell: the single input token
 *                         at the input amount (native → empty); redeem: the
 *                         {YT, PT} pair (Convert asks both), each at the input
 *                         amount. Spender is IMPLICIT = the pinned Router.
 *   5. Calldata bind    : FULL `decodeFunctionData` against the complete Router
 *                         ABI (structs from IPAllActionTypeV3) and assert EVERY
 *                         intent-relevant param:
 *                           - the method is valid for the action,
 *                           - decoded receiver == the session wallet,
 *                           - decoded market/YT == the quoted market/YT,
 *                           - the ACTUAL spend inside the dynamic tuples binds:
 *                             buy  → TokenInput.tokenIn == the intent input token
 *                                    (zero address for native) AND
 *                                    TokenInput.netTokenIn == the input wei,
 *                             sell → exactPtIn == the input wei AND
 *                                    TokenOutput.tokenOut == the quoted output,
 *                             redeem → netPyIn == the input wei AND (for
 *                                    redeemPyToToken) TokenOutput.tokenOut ==
 *                                    the quoted output.
 *                         The echoed contractParamInfo is cross-checked against
 *                         the DECODED values so a spoofed echo is caught too.
 */

import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";

import { VexError, ErrorCodes } from "../../../../errors.js";
import {
  PENDLE_NATIVE_TOKEN,
  PENDLE_ROUTER,
  PENDLE_ROUTER_ABI,
  type PendleRouterMethod,
} from "@tools/pendle/constants.js";
import type { PendleConvertResponse, PendleConvertRoute } from "@tools/pendle/types.js";

export type PendleAction = "buy" | "sell" | "redeem";

export interface PendleTxIntent {
  action: PendleAction;
  /** Session wallet — the ONLY allowed receiver + sender. */
  wallet: Address;
  /** Input token (native sentinel for native ETH input). */
  inputToken: Address;
  /** Input amount in wei (matches Convert `inputs[0].amount`). */
  inputAmountWei: bigint;
  isNative: boolean;
  /** Buy/sell: the PT's canonical market. Asserted against the decoded market. */
  expectedMarket?: Address;
  /** Redeem: the PT's canonical YT. Asserted against the decoded YT. */
  expectedYt?: Address;
  /** PT contract — part of the redeem approval set. */
  ptAddress?: Address;
  /** Sell/redeem: the quoted output token — asserted against TokenOutput.tokenOut. */
  expectedOutputToken?: Address;
}

/** Method(s) a given action may legitimately carry. */
const ACTION_METHODS: Record<PendleAction, readonly PendleRouterMethod[]> = {
  buy: ["swapExactTokenForPt"],
  sell: ["swapExactPtForToken"],
  redeem: ["redeemPyToToken", "redeemPyToSy"],
};

function unsafe(reason: string): never {
  throw new VexError(
    ErrorCodes.PENDLE_UNSAFE_TX,
    `Pendle refused to sign: ${reason}.`,
    "The quoted transaction did not match the requested trade. Re-quote and retry; do not approve.",
  );
}

/** Try to checksum an address; unsafe() on a malformed value. */
function requireAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch {
    return unsafe(`${label} is not a valid address`);
  }
}

// ── Full calldata decode ────────────────────────────────────────────

interface TokenTupleBind {
  /** TokenInput.tokenIn or TokenOutput.tokenOut. */
  token: Address;
}

export interface DecodedRouterCall {
  method: PendleRouterMethod;
  /** Where the proceeds land (arg 0 on all four methods). */
  receiver: Address;
  /** Market (buy/sell) or YT (redeem) — arg 1 on all four methods. */
  marketOrYt: Address;
  /**
   * The ACTUAL spend amount the Router will pull: TokenInput.netTokenIn (buy),
   * exactPtIn (sell), netPyIn (redeem).
   */
  spendWei: bigint;
  /** Buy: the decoded TokenInput.tokenIn (zero address for native). */
  input?: TokenTupleBind;
  /** Sell / redeemPyToToken: the decoded TokenOutput.tokenOut. */
  output?: TokenTupleBind;
}

/**
 * FULL-decode a Pendle Router call. An unknown selector, a truncated body, or a
 * layout that does not decode against the complete ABI → unsafe. Returns the
 * normalized intent-relevant params. (ABI selectors are pinned by tests that
 * decode LIVE-probed calldata.)
 */
export function decodeRouterCall(data: string): DecodedRouterCall {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(data)) {
    return unsafe("transaction calldata is malformed");
  }
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: PENDLE_ROUTER_ABI, data: data as Hex }) as {
      functionName: string;
      args: readonly unknown[];
    };
  } catch {
    return unsafe("transaction does not decode as a known Router method");
  }
  const args = decoded.args;
  const receiver = getAddress(args[0] as string);
  const marketOrYt = getAddress(args[1] as string);

  switch (decoded.functionName) {
    case "swapExactTokenForPt": {
      const input = args[4] as { tokenIn: string; netTokenIn: bigint };
      return {
        method: "swapExactTokenForPt",
        receiver,
        marketOrYt,
        spendWei: input.netTokenIn,
        input: { token: getAddress(input.tokenIn) },
      };
    }
    case "swapExactPtForToken": {
      const output = args[3] as { tokenOut: string };
      return {
        method: "swapExactPtForToken",
        receiver,
        marketOrYt,
        spendWei: args[2] as bigint,
        output: { token: getAddress(output.tokenOut) },
      };
    }
    case "redeemPyToToken": {
      const output = args[3] as { tokenOut: string };
      return {
        method: "redeemPyToToken",
        receiver,
        marketOrYt,
        spendWei: args[2] as bigint,
        output: { token: getAddress(output.tokenOut) },
      };
    }
    case "redeemPyToSy":
      return {
        method: "redeemPyToSy",
        receiver,
        marketOrYt,
        spendWei: args[2] as bigint,
      };
    default:
      return unsafe("transaction calls an unknown Router method");
  }
}

// ── Approval-set binding ────────────────────────────────────────────

function assertApprovals(intent: PendleTxIntent, response: PendleConvertResponse): void {
  const approvals = response.requiredApprovals;
  const amount = intent.inputAmountWei.toString();

  if (intent.action === "redeem") {
    const yt = intent.expectedYt ? getAddress(intent.expectedYt) : null;
    const pt = intent.ptAddress ? getAddress(intent.ptAddress) : null;
    if (!yt || !pt) return unsafe("redeem approval check missing PT/YT");
    const allowed = new Set([yt, pt]);
    const seen = new Set<string>();
    for (const a of approvals) {
      const token = requireAddress(a.token, "approval token");
      if (!allowed.has(token)) return unsafe("an approval targets an unexpected token");
      if (seen.has(token)) return unsafe("duplicate approval token");
      if (a.amount !== amount) return unsafe("an approval amount does not match the input");
      seen.add(token);
    }
    return;
  }

  // Buy/sell: native input needs no approval; otherwise EXACTLY one, for the
  // input token, at the input amount, and nothing else.
  if (intent.isNative) {
    if (approvals.length !== 0) return unsafe("native input must not require any token approval");
    return;
  }
  if (approvals.length !== 1) return unsafe("expected exactly one token approval");
  const only = approvals[0]!;
  if (requireAddress(only.token, "approval token") !== getAddress(intent.inputToken)) {
    return unsafe("the approval targets a token other than the input");
  }
  if (only.amount !== amount) return unsafe("the approval amount does not match the input");
}

// ── Route validation ────────────────────────────────────────────────

/**
 * Validate ONE Convert route against the intent. Returns the route when safe;
 * throws `PENDLE_UNSAFE_TX` otherwise. `response` carries the requiredApprovals
 * (approvals are response-level, not per-route).
 */
export function assertRouteSafe(
  intent: PendleTxIntent,
  response: PendleConvertResponse,
  route: PendleConvertRoute,
): PendleConvertRoute {
  // 1. Router pin.
  if (requireAddress(route.tx.to, "tx.to") !== PENDLE_ROUTER) {
    return unsafe("transaction target is not the pinned Pendle Router");
  }

  // 2. Sender bind.
  if (route.tx.from !== null && route.tx.from !== "") {
    if (requireAddress(route.tx.from, "tx.from") !== getAddress(intent.wallet)) {
      return unsafe("transaction sender is not the session wallet");
    }
  }

  // 3. Value bind.
  const rawValue = route.tx.value;
  const value = rawValue !== null && rawValue !== "" ? BigInt(rawValue) : 0n;
  if (intent.isNative) {
    if (value !== intent.inputAmountWei) return unsafe("native value does not match the input amount");
  } else if (value !== 0n) {
    return unsafe("a non-native trade must not send native value");
  }

  // 4. Approvals bind (response-level).
  assertApprovals(intent, response);

  // 5. Calldata bind — FULL decode; every intent-relevant param asserted.
  const call = decodeRouterCall(route.tx.data);
  if (!ACTION_METHODS[intent.action].includes(call.method)) {
    return unsafe(`transaction method ${call.method} is not valid for a ${intent.action}`);
  }
  if (call.receiver !== getAddress(intent.wallet)) {
    return unsafe("transaction receiver is not the session wallet");
  }
  const expectedTarget =
    intent.action === "redeem" ? intent.expectedYt : intent.expectedMarket;
  if (expectedTarget && call.marketOrYt !== getAddress(expectedTarget)) {
    return unsafe(
      intent.action === "redeem"
        ? "transaction YT does not match the position"
        : "transaction market does not match the quote",
    );
  }

  // The ACTUAL spend inside the calldata must equal the intent amount — an
  // inflated netTokenIn/exactPtIn/netPyIn can never reach a signature.
  if (call.spendWei !== intent.inputAmountWei) {
    return unsafe("transaction spend amount does not match the quoted input");
  }
  // Buy: the tuple's spend token must be the intent input (zero addr for native).
  if (call.method === "swapExactTokenForPt") {
    const expectedIn = intent.isNative ? PENDLE_NATIVE_TOKEN : getAddress(intent.inputToken);
    if (!call.input || call.input.token !== expectedIn) {
      return unsafe("transaction input token does not match the quoted input");
    }
  }
  // Sell / redeemPyToToken: the tuple's output token must be the quoted output.
  if (call.output && intent.expectedOutputToken) {
    if (call.output.token !== getAddress(intent.expectedOutputToken)) {
      return unsafe("transaction output token does not match the quote");
    }
  }

  // Cross-check the echoed contractParamInfo against the DECODED values so a
  // spoofed echo cannot mislead downstream logging/UX.
  const params = route.contractParamInfo.contractCallParams;
  const echoReceiver = typeof params[0] === "string" ? params[0] : "";
  const echoTarget = typeof params[1] === "string" ? params[1] : "";
  if (echoReceiver !== "" && requireAddress(echoReceiver, "echoed receiver") !== call.receiver) {
    return unsafe("echoed receiver disagrees with the calldata");
  }
  if (echoTarget !== "" && requireAddress(echoTarget, "echoed market/YT") !== call.marketOrYt) {
    return unsafe("echoed market/YT disagrees with the calldata");
  }

  return route;
}

/**
 * Pick the SAFEST usable route from a Convert response for the intent: the first
 * route (best-ranked by Pendle) that passes every fund-safety check. Throws
 * `PENDLE_UNSAFE_TX` when none is safe (never falls back to an unchecked route).
 */
export function selectSafeRoute(
  intent: PendleTxIntent,
  response: PendleConvertResponse,
): PendleConvertRoute {
  let lastErr: unknown;
  for (const route of response.routes) {
    try {
      return assertRouteSafe(intent, response, route);
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr instanceof VexError) throw lastErr;
  return unsafe("no route passed the fund-safety checks");
}
