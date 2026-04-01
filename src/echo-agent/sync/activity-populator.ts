/**
 * Activity populator — maps normalized _tradeCapture → proj_activity row.
 *
 * Called from populateCaptureItems() in runtime.ts after recording capture items.
 * Batch captures (predict.closeAll) produce N activity rows per execution.
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
  // Safe audit types — projector skips these (switch/case default → return)
  wrap: "wrap",
  allowance: "allowance",
  send: "send",
  account: "account",
  token_create: "token_create",
  studio: "studio",
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
  captureItemId: number | null,
  toolId: string,
  namespace: string,
  tradeCapture: Record<string, unknown>,
  executionExternalRefs?: Record<string, string>,
): Promise<void> {
  const type = typeof tradeCapture.type === "string" ? tradeCapture.type : "unknown";
  const productType = TYPE_TO_PRODUCT[type] ?? type;
  const chain = typeof tradeCapture.chain === "string" ? tradeCapture.chain : "unknown";

  const tradeSide = deriveTradeSide(tradeCapture, toolId, productType);

  // Extract valuation fields as strings — preserve precision for NUMERIC columns
  const inputValueUsd = typeof tradeCapture.inputValueUsd === "string" ? tradeCapture.inputValueUsd : null;
  const outputValueUsd = typeof tradeCapture.outputValueUsd === "string" ? tradeCapture.outputValueUsd : null;

  const id = await activityRepo.insertActivity({
    namespace,
    activityType: type,
    productType,
    tradeSide,
    chain,
    executionId,
    captureItemId,
    walletAddress: typeof tradeCapture.walletAddress === "string" ? tradeCapture.walletAddress : null,
    inputToken: typeof tradeCapture.inputTokenAddress === "string" ? tradeCapture.inputTokenAddress
      : typeof tradeCapture.inputToken === "string" ? tradeCapture.inputToken : null,
    inputAmount: typeof tradeCapture.inputAmount === "string" ? tradeCapture.inputAmount : null,
    outputToken: typeof tradeCapture.outputTokenAddress === "string" ? tradeCapture.outputTokenAddress
      : typeof tradeCapture.outputToken === "string" ? tradeCapture.outputToken : null,
    outputAmount: typeof tradeCapture.outputAmount === "string" ? tradeCapture.outputAmount : null,
    valueUsd: null,
    inputValueUsd,
    outputValueUsd,
    feeValueUsd: typeof tradeCapture.feeValueUsd === "string" ? tradeCapture.feeValueUsd : null,
    unitPriceUsd: typeof tradeCapture.unitPriceUsd === "string" ? tradeCapture.unitPriceUsd : null,
    valuationSource: typeof tradeCapture.valuationSource === "string" ? tradeCapture.valuationSource : null,
    captureStatus: typeof tradeCapture.status === "string" ? tradeCapture.status : null,
    positionKey: typeof tradeCapture.positionKey === "string" ? tradeCapture.positionKey : null,
    instrumentKey: typeof tradeCapture.instrumentKey === "string" ? tradeCapture.instrumentKey : null,
    externalRefs: executionExternalRefs ?? {},
    meta: (tradeCapture.meta as Record<string, unknown>) ?? {},
  });

  if (id > 0) {
    logger.debug("sync.activity.populated", { executionId, captureItemId, productType, tradeSide, namespace });

    // Project into open positions / lot ledger
    try {
      const activityRows = await activityRepo.getByExecution(executionId);
      const activityRow = captureItemId != null
        ? activityRows.find(r => r.captureItemId === captureItemId)
        : activityRows.find(r => r.id === id);  // match by freshly inserted id (safe for replay with null captureItemId)
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
}
