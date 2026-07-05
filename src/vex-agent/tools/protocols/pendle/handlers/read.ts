/**
 * Pendle read handlers — discovery (pendle.yields) + valuation
 * (pendle.position.value). Read-only: no wallet signing, no mutations.
 *
 * Every provider response is untrusted → validated by the client, then narrowed
 * again through the trusted-fields projector boundary before the model sees it.
 * Upstream error text NEVER reaches the model — only bounded, code-keyed detail.
 */

import { getPendleClient } from "@tools/pendle/client.js";
import { PENDLE_CHAIN_ID } from "@tools/pendle/constants.js";
import { resolveSelectedAddress } from "@vex-agent/tools/internal/wallet/resolve.js";
import { VexError } from "../../../../../errors.js";
import logger from "@utils/logger.js";
import type { ProtocolHandler, ProtocolExecutionContext } from "../../types.js";
import { num, str, ok, fail } from "../../handler-helpers.js";
import type { PendleAsset, PendleMarket } from "@tools/pendle/types.js";
import { projectMarkets, projectPtPositions } from "../projectors.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Model-facing failure detail — code-keyed + bounded, never upstream text. */
function failureDetail(toolId: string, err: unknown): string {
  logger.warn("pendle.handler.error", {
    toolId,
    code: err instanceof VexError ? err.code : "UNEXPECTED",
    error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
  });
  if (err instanceof VexError) return err.hint ? `${err.code}: ${err.hint}` : err.code;
  return "unexpected error";
}

function clampLimit(requested: number | undefined): number {
  if (requested !== undefined && requested > 0) return Math.min(Math.floor(requested), MAX_LIMIT);
  return DEFAULT_LIMIT;
}

async function pendleYields(p: Record<string, unknown>): Promise<ReturnType<typeof ok>> {
  const sortRaw = str(p, "sort").trim().toLowerCase();
  const sort = sortRaw === "apy" ? "apy" : "liquidity";
  const limit = clampLimit(num(p, "limit"));
  try {
    const markets = await getPendleClient().getActiveMarkets();
    const projected = projectMarkets(markets, sort).slice(0, limit);
    return ok({
      chainId: PENDLE_CHAIN_ID,
      sort,
      count: projected.length,
      totalMarkets: markets.length,
      markets: projected,
    });
  } catch (err) {
    return fail(`Pendle yields unavailable (${failureDetail("pendle.yields", err)})`);
  }
}

async function pendlePositionValue(
  _p: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<ReturnType<typeof ok>> {
  let wallet: string;
  try {
    wallet = resolveSelectedAddress(context.walletResolution, context.walletPolicy, "eip155");
  } catch (err) {
    return fail(`Pendle positions unavailable — no Ethereum wallet selected (${failureDetail("pendle.position.value", err)})`);
  }

  try {
    const client = getPendleClient();
    const [positionsByChain, markets, assets] = await Promise.all([
      client.getPositions(wallet),
      client.getActiveMarkets(),
      client.getAllAssets(),
    ]);
    const marketByAddress = new Map<string, PendleMarket>();
    for (const m of markets) marketByAddress.set(m.address.toLowerCase(), m);
    const assetByAddress = new Map<string, PendleAsset>();
    for (const a of assets) assetByAddress.set(a.address.toLowerCase(), a);

    const ethChain = positionsByChain.find((c) => c.chainId === PENDLE_CHAIN_ID);
    const positions = projectPtPositions(ethChain?.openPositions ?? [], marketByAddress, assetByAddress);
    const totalValueUsd = positions.reduce((sum, pos) => sum + (pos.valueUsd ?? 0), 0);
    const redeemable = positions.filter((pos) => pos.redeemable).length;

    return ok({
      chainId: PENDLE_CHAIN_ID,
      wallet,
      count: positions.length,
      redeemableCount: redeemable,
      totalValueUsd,
      positions,
    });
  } catch (err) {
    return fail(`Pendle positions unavailable (${failureDetail("pendle.position.value", err)})`);
  }
}

export const PENDLE_READ_HANDLERS: Record<string, ProtocolHandler> = {
  "pendle.yields": (p) => pendleYields(p),
  "pendle.position.value": (p, ctx) => pendlePositionValue(p, ctx),
};
