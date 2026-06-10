/**
 * Capture pipeline — shared logic for recording capture items and populating activity.
 *
 * Used by:
 * - runtime.ts (inline after execution)
 * - replay.ts (one-time historical correction)
 *
 * Pipeline: capture items → recordCaptureItems() → populateActivity() per item
 */

import { sanitizeJsonbValue } from "@vex-agent/db/params.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import type { LedgerWakeKey } from "@vex-agent/memory/ledger-wake.js";

/**
 * Extract external_refs from handler result data for correlation/lookup.
 * Maps known fields per namespace to canonical keys.
 */
export function extractExternalRefs(data: Record<string, unknown> | undefined): Record<string, string> {
  if (!data) return {};
  const refs: Record<string, string> = {};
  const candidates = ["txHash", "orderId", "positionPubkey", "orderKey", "positionId", "conditionId", "signature", "instrumentKey", "positionKey"];

  for (const key of candidates) {
    let value = data[key];
    // Normalize: Polymarket returns "orderID" instead of "orderId"
    if (value === undefined && key === "orderId") value = data["orderID"];
    // Coerce numbers to strings (KyberSwap orderId can be number)
    if (typeof value === "number") value = String(value);
    if (typeof value === "string" && value) refs[key] = value;
  }

  // Check nested _tradeCapture for refs not in top-level data
  const capture = data._tradeCapture as Record<string, unknown> | undefined;
  if (capture) {
    if (!refs.signature && typeof capture.signature === "string" && capture.signature) {
      refs.signature = capture.signature;
    }
    if (!refs.positionKey && typeof capture.positionKey === "string" && capture.positionKey) {
      refs.positionKey = capture.positionKey;
    }
    if (!refs.instrumentKey && typeof capture.instrumentKey === "string" && capture.instrumentKey) {
      refs.instrumentKey = capture.instrumentKey;
    }
    const meta = capture.meta as Record<string, unknown> | undefined;
    if (!refs.positionPubkey && typeof meta?.positionPubkey === "string" && meta.positionPubkey) {
      refs.positionPubkey = meta.positionPubkey;
    }
    if (!refs.conditionId && typeof meta?.conditionId === "string" && meta.conditionId) {
      refs.conditionId = meta.conditionId;
    }
  }

  return refs;
}

/**
 * Record capture items and populate activity rows.
 *
 * Batch handlers (predict.closeAll) emit _tradeCaptureItems → N items → N activity rows.
 * Single handlers emit _tradeCapture → synthesized 1 item → 1 activity row.
 */
export async function populateCaptureItems(
  executionId: number,
  toolId: string,
  namespace: string,
  tradeCapture: Record<string, unknown> | null,
  tradeCaptureItems: Record<string, unknown>[] | undefined,
  executionExternalRefs: Record<string, string>,
): Promise<void> {
  const items: Record<string, unknown>[] = Array.isArray(tradeCaptureItems) && tradeCaptureItems.length > 0
    ? tradeCaptureItems
    : tradeCapture ? [tradeCapture] : [];

  if (items.length === 0) return;
  const sanitizedItems = items.map(sanitizeCaptureRecord);

  const { recordCaptureItems } = await import("@vex-agent/db/repos/capture-items.js");
  const { populateActivity } = await import("@vex-agent/sync/activity-populator.js");

  const captureItemIds = await recordCaptureItems(
    executionId,
    sanitizedItems.map(item => ({
      tradeCapture: item,
      externalRefs: extractExternalRefs({ _tradeCapture: item }),
    })),
  );

  const wakeKeys: LedgerWakeKey[] = [];
  for (let i = 0; i < sanitizedItems.length; i++) {
    const itemRefs = extractExternalRefs({ _tradeCapture: sanitizedItems[i] });
    const mergedRefs = { ...executionExternalRefs, ...itemRefs };
    await populateActivity(executionId, captureItemIds[i] ?? null, toolId, namespace, sanitizedItems[i], mergedRefs);
    wakeKeys.push({
      executionId,
      ...(mergedRefs.instrumentKey ? { instrumentKey: mergedRefs.instrumentKey } : {}),
      ...(mergedRefs.positionKey ? { positionKey: mergedRefs.positionKey } : {}),
    });
  }

  // ── S7 D-SEAM: ledger→memory wake (the ONLY call site) ────────────────────
  // The projections above are committed, so a reconcile pass triggered by this
  // wake reads the post-write ledger. This single seam covers agent trades AND
  // settlement sync (recordSyntheticCapture → populateCaptureItems), while
  // replayActivityFromCapture below structurally bypasses it (no wake storm on
  // replay). F3 (owner fork): wallet_intents are deliberately OUT of the wake
  // path — nothing here (or in the outcome resolver) reads wallet_intents; an
  // intent-driven wake would be a dead coupling with nothing to recompute, and
  // the real fill data lands in proj_* through sync anyway. Best-effort: a wake
  // failure NEVER breaks the capture/sync pipeline — the ledger is the source
  // of truth and memory catches up on the next wake for the same keys.
  try {
    const { enqueueLedgerWake } = await import("@vex-agent/memory/ledger-wake.js");
    await enqueueLedgerWake(wakeKeys);
  } catch (err: unknown) {
    memLog.warn("reconcile", "wake_failed", {
      errorCode: err instanceof Error ? "wake_error" : "wake_unknown",
    });
  }
}

/**
 * Populate activity rows from existing capture items (for replay).
 * Does NOT record new capture items — reads what's already in the DB.
 * Preserves capture_item_id FK when available.
 */
export async function replayActivityFromCapture(
  executionId: number,
  toolId: string,
  namespace: string,
  captureItems: { id: number | null; data: Record<string, unknown> }[],
  executionExternalRefs: Record<string, string>,
): Promise<void> {
  const { populateActivity } = await import("@vex-agent/sync/activity-populator.js");

  for (const item of captureItems) {
    const itemRefs = extractExternalRefs({ _tradeCapture: item.data });
    const mergedRefs = { ...executionExternalRefs, ...itemRefs };
    await populateActivity(executionId, item.id, toolId, namespace, item.data, mergedRefs);
  }
}

function sanitizeCaptureRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeJsonbValue(value);
  return isRecord(sanitized) ? sanitized : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
