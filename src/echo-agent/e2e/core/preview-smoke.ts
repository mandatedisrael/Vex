/**
 * Preview smoke — verify dryRun produces zero writes in all pipeline tables.
 *
 * Takes snapshot before, executes preview tools, takes snapshot after.
 * All counts must be identical.
 *
 * IMPORTANT: This checks the invariant "dryRun never writes to DB", NOT that
 * each handler correctly entered its preview branch. Handlers may fail before
 * reaching dryRun (e.g. slop validates token, polymarket looks up market).
 * Handler failures are acceptable — what matters is zero writes.
 */

import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import { makeContext } from "./scenario-runner.js";
import { takePipelineSnapshot, type PipelineSnapshot } from "./db-assertions.js";
import logger from "@utils/logger.js";

/** Subset of previewSupport tools that don't require seed funds for dryRun. */
const PREVIEW_SMOKE_TOOLS: { toolId: string; params: Record<string, unknown> }[] = [
  { toolId: "khalani.bridge", params: { fromChain: "ethereum", toChain: "arbitrum", fromToken: "USDC", toToken: "USDC", amount: "1000000", dryRun: true } },
  { toolId: "kyberswap.swap.buy", params: { chain: "ethereum", tokenIn: "USDC", tokenOut: "WETH", amountIn: "1", dryRun: true } },
  { toolId: "jaine.swap.sell", params: { tokenIn: "w0G", tokenOut: "USDC", amountIn: "1", dryRun: true } },
  { toolId: "slop.trade.buy", params: { token: "0x0000000000000000000000000000000000000001", amountOg: "0.01", dryRun: true } },
  { toolId: "polymarket.clob.buy", params: { conditionId: "0x0000000000000000000000000000000000000000000000000000000000000001", outcome: "yes", amount: 1, dryRun: true } },
];

export interface PreviewSmokeResult {
  /** True if zero writes across all 6 pipeline tables */
  pass: boolean;
  before: PipelineSnapshot;
  after: PipelineSnapshot;
  toolResults: { toolId: string; success: boolean; handlerFailed: boolean }[];
}

export async function runPreviewSmoke(): Promise<PreviewSmokeResult> {
  const ctx = makeContext(`preview-smoke-${Date.now()}`);
  const before = await takePipelineSnapshot();
  const toolResults: PreviewSmokeResult["toolResults"] = [];

  for (const { toolId, params } of PREVIEW_SMOKE_TOOLS) {
    try {
      const result = await dispatchTool(
        {
          name: "execute_tool",
          args: { toolId, params },
          toolCallId: `preview-${toolId}-${Date.now()}`,
        },
        ctx,
      );

      toolResults.push({
        toolId,
        success: result.success,
        handlerFailed: !result.success,
      });
    } catch (err) {
      // Handler failures are expected (missing wallet, invalid token, missing API key).
      // What matters is the invariant: zero writes to DB regardless of handler outcome.
      toolResults.push({ toolId, success: false, handlerFailed: true });
      logger.debug("e2e.preview_smoke.tool_error", {
        toolId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const after = await takePipelineSnapshot();

  const pass = before.executions === after.executions
    && before.captureItems === after.captureItems
    && before.activities === after.activities
    && before.openPositions === after.openPositions
    && before.lots === after.lots
    && before.matches === after.matches
    && before.lpEvents === after.lpEvents
    && before.lpLegs === after.lpLegs;

  logger.info("e2e.preview_smoke.result", { pass, before, after });

  return { pass, before, after, toolResults };
}
