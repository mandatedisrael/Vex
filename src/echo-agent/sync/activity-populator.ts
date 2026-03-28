/**
 * Activity populator — maps normalized _tradeCapture → proj_activity row.
 *
 * Called from captureExecution() in runtime.ts after recording to protocol_executions.
 * Idempotent via UNIQUE(execution_id) in proj_activity.
 */

import * as activityRepo from "@echo-agent/db/repos/activity.js";
import logger from "@utils/logger.js";

// ── Product type mapping ────────────────────────────────────────

const TYPE_TO_PRODUCT: Record<string, string> = {
  swap: "spot",
  bridge: "bridge",
  perps: "perps",
  prediction: "prediction",
  lend: "lend",
  stake: "stake",
  lp: "lp",
  order: "order",
  reward: "reward",
};

// ── Trade side rules ────────────────────────────────────────────
// ONLY real trades get buy/sell. Everything else gets null.

const TRADE_SIDE_PRODUCTS = new Set(["spot", "perps", "prediction"]);

function deriveTradeSide(
  tradeCapture: Record<string, unknown>,
  toolId: string,
  productType: string,
): string | null {
  // If capture has explicit tradeSide, use it (handlers set this now)
  if (typeof tradeCapture.tradeSide === "string") {
    return tradeCapture.tradeSide;
  }

  // Only derive for real trade products
  if (!TRADE_SIDE_PRODUCTS.has(productType)) return null;

  // Derive from tool name — claim is NOT a sell (it's profit realization, not position close)
  const toolName = toolId.split(".").pop() ?? "";
  if (toolName === "buy" || toolName === "open") return "buy";
  if (toolName === "sell" || toolName === "close") return "sell";
  // claim, delegate, deposit, withdraw, clawback → null (not trade side)

  // Derive from meta.side (perps)
  const meta = tradeCapture.meta as Record<string, unknown> | undefined;
  if (typeof meta?.side === "string") {
    return meta.side === "long" ? "buy" : meta.side === "short" ? "sell" : null;
  }

  return null;
}

// ── Main populator ──────────────────────────────────────────────

export async function populateActivity(
  executionId: number,
  toolId: string,
  namespace: string,
  tradeCapture: Record<string, unknown>,
  executionExternalRefs?: Record<string, string>,
): Promise<void> {
  const type = typeof tradeCapture.type === "string" ? tradeCapture.type : "unknown";
  const productType = TYPE_TO_PRODUCT[type] ?? type;
  const chain = typeof tradeCapture.chain === "string" ? tradeCapture.chain : "unknown";

  const tradeSide = deriveTradeSide(tradeCapture, toolId, productType);

  const id = await activityRepo.insertActivity({
    namespace,
    activityType: type,
    productType,
    tradeSide,
    chain,
    executionId,
    walletAddress: typeof tradeCapture.walletAddress === "string" ? tradeCapture.walletAddress : null,
    inputToken: typeof tradeCapture.inputTokenAddress === "string" ? tradeCapture.inputTokenAddress
      : typeof tradeCapture.inputToken === "string" ? tradeCapture.inputToken : null,
    inputAmount: typeof tradeCapture.inputAmount === "string" ? tradeCapture.inputAmount : null,
    outputToken: typeof tradeCapture.outputTokenAddress === "string" ? tradeCapture.outputTokenAddress
      : typeof tradeCapture.outputToken === "string" ? tradeCapture.outputToken : null,
    outputAmount: typeof tradeCapture.outputAmount === "string" ? tradeCapture.outputAmount : null,
    valueUsd: null, // Calculated later by reconciler
    captureStatus: typeof tradeCapture.status === "string" ? tradeCapture.status : null,
    positionKey: typeof tradeCapture.positionKey === "string" ? tradeCapture.positionKey : null,
    instrumentKey: typeof tradeCapture.instrumentKey === "string" ? tradeCapture.instrumentKey : null,
    externalRefs: executionExternalRefs ?? {},
    meta: (tradeCapture.meta as Record<string, unknown>) ?? {},
  });

  if (id > 0) {
    logger.debug("sync.activity.populated", { executionId, productType, tradeSide, namespace });

    // Project into open positions / lot ledger
    try {
      const activityRow = await activityRepo.getByExecution(executionId);
      if (activityRow) {
        const { projectPosition } = await import("./position-projector.js");
        await projectPosition(activityRow);
      }
    } catch (err) {
      logger.warn("sync.activity.projection_failed", {
        executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // id === 0 means ON CONFLICT DO NOTHING fired (duplicate) — that's fine
}
