/**
 * Canonical mutation matrix — single source-of-truth for capture contracts.
 *
 * Imported by runtime.ts (validation, preview detection), tests (structural coverage),
 * and replay.ts (type correction). Every mutating protocol tool is classified exactly once.
 *
 * Non-mutating tools are implicit read_only — not listed here.
 */

import type { PortfolioRole, CaptureSupport } from "./types.js";

// ── Contract per mutation ──────────────────────────────────────

export interface MutationContract {
  /** Business semantics for downstream projections. */
  role: PortfolioRole;
  /** Whether handler produces _tradeCapture. */
  capture: CaptureSupport;
  /** Expected _tradeCapture.type value(s). Array for dual-type tools (e.g. Polymarket buy/sell). */
  expectedType: string | string[];
  /** Handler supports dryRun param → runtime skips approval + capture for previews. */
  previewSupport: boolean;
  /** Single _tradeCapture vs _tradeCaptureItems for bulk operations. */
  fanOut: "single" | "items";
  /** Minimum required fields in _tradeCapture for capture:"full". Empty for capture:"none". */
  requiredFields: readonly string[];
  /** Named exceptions to requiredFields (e.g. "claim: no instrumentKey"). */
  exceptions?: readonly string[];
  /**
   * Handler's USD valuation capability. Drives regression tests (soft contract, not runtime gate).
   * - "exact": always emits exact USD from source API (inputValueUsd/outputValueUsd/valuationSource).
   * - "conditional": emits exact USD only on certain paths (e.g. Polymarket matched vs unmatched).
   * - "none": no USD from source — honest null / valuationSource: "none".
   */
  valuationExpected: "exact" | "conditional" | "none";
}

// ── Required field sets per role ────────────────────────────────

const PNL_SPOT_FIELDS = [
  "type", "walletAddress", "tradeSide", "instrumentKey",
  "inputTokenAddress", "outputTokenAddress", "inputAmount", "outputAmount",
] as const;

const PNL_PREDICTION_FIELDS = [
  "type", "walletAddress", "status", "positionKey", "instrumentKey",
] as const;

const PROJECTION_FIELDS = [
  "type", "positionKey", "status",
] as const;

const AUDIT_FIELDS = [
  "type", "walletAddress", "status",
] as const;

const NO_FIELDS: readonly string[] = [];

// ── Matrix entries ─────────────────────────────────────────────

const entries: [string, MutationContract][] = [
  // ── pnl_spot ──────────────────────────────────────────────
  ["solana.swap.execute",    { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: false, fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],
  ["jaine.swap.sell",        { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "none" }],
  ["jaine.swap.buy",         { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "none" }],
  ["kyberswap.swap.sell",    { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],
  ["kyberswap.swap.buy",     { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],
  ["slop.trade.buy",         { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "none" }],
  ["slop.trade.sell",        { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "none" }],

  // ── pnl_prediction ────────────────────────────────────────
  // Solana predictions — single positionPubkey per buy/sell/claim
  ["solana.predict.buy",     { role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "single", requiredFields: PNL_PREDICTION_FIELDS, valuationExpected: "exact" }],
  ["solana.predict.sell",    { role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "single", requiredFields: PNL_PREDICTION_FIELDS, valuationExpected: "exact" }],
  ["solana.predict.claim",   { role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "single", requiredFields: ["walletAddress", "status", "positionKey"], exceptions: ["claim: no instrumentKey — matches via positionKey"], valuationExpected: "exact" }],
  ["solana.predict.closeAll",{ role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "items",  requiredFields: PNL_PREDICTION_FIELDS, valuationExpected: "exact" }],

  // Polymarket CLOB — dual-type: matched→prediction (position, exact valuation), live→order (pending, no valuation)
  ["polymarket.clob.buy",    { role: "pnl_prediction", capture: "full", expectedType: ["prediction", "order"], previewSupport: true,  fanOut: "single", requiredFields: ["walletAddress", "status", "positionKey", "instrumentKey"], valuationExpected: "conditional" }],
  ["polymarket.clob.sell",   { role: "pnl_prediction", capture: "full", expectedType: ["prediction", "order"], previewSupport: true,  fanOut: "single", requiredFields: ["walletAddress", "status", "positionKey", "instrumentKey"], valuationExpected: "conditional" }],

  // Polymarket cancel* — order lifecycle, not prediction position
  ["polymarket.clob.cancel",       { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["polymarket.clob.cancelOrders", { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["polymarket.clob.cancelAll",    { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["polymarket.clob.cancelMarket", { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],

  // ── projection (orders, LP) ───────────────────────────────
  ["kyberswap.limitOrder.create",    { role: "projection", capture: "full", expectedType: "order", previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.cancel",    { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.hardCancel",{ role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.fill",      { role: "projection", capture: "full", expectedType: "order", previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.batchFill", { role: "projection", capture: "full", expectedType: "order", previewSupport: true,  fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.cancelAll", { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.zap.in",              { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.zap.out",             { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.zap.migrate",         { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],

  // ── audit (capture: full) ─────────────────────────────────
  ["khalani.bridge",           { role: "audit", capture: "full", expectedType: "bridge",       previewSupport: true,  fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["solana.lend.deposit",      { role: "audit", capture: "full", expectedType: "lend",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["solana.lend.withdraw",     { role: "audit", capture: "full", expectedType: "lend",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["slop.fees.claimCreator",   { role: "audit", capture: "full", expectedType: "reward",       previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["slop.fees.lpCollect",      { role: "audit", capture: "full", expectedType: "reward",       previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["slop.reward.claim",        { role: "audit", capture: "full", expectedType: "reward",       previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["jaine.w0g.wrap",           { role: "audit", capture: "full", expectedType: "wrap",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["jaine.w0g.unwrap",         { role: "audit", capture: "full", expectedType: "wrap",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["jaine.allowance.approve",  { role: "audit", capture: "full", expectedType: "allowance",    previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["jaine.allowance.revoke",   { role: "audit", capture: "full", expectedType: "allowance",    previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["slop.token.create",        { role: "audit", capture: "full", expectedType: "token_create", previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],

  // ── audit (capture: none — address creation, no direct tx) ─
  ["polymarket.bridge.deposit",  { role: "audit", capture: "none", expectedType: "bridge", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["polymarket.bridge.withdraw", { role: "audit", capture: "none", expectedType: "bridge", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],

  // ── utility (no portfolio impact) ─────────────────────────
  ["echobook.post.create",            { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.post.delete",            { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.comment.create",         { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.comment.delete",         { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.follow.toggle",          { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.vote.post",              { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.vote.comment",           { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.repost",                 { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.profile.update",         { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.submolt.join",           { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.submolt.leave",          { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.tradeProof.submit",      { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["echobook.notifications.markRead", { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["slop-app.profile.register",       { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["slop-app.image.upload",           { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["slop-app.image.generate",         { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["slop-app.chat.post",              { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["polymarket.clob.heartbeat",       { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
];

// ── Exported map ───────────────────────────────────────────────

export const MUTATION_MATRIX: ReadonlyMap<string, MutationContract> = new Map(entries);

// ── Helpers ────────────────────────────────────────────────────

/** Check if a type matches the expectedType (supports string | string[]). */
export function isExpectedType(contract: MutationContract, actualType: string): boolean {
  if (Array.isArray(contract.expectedType)) {
    return contract.expectedType.includes(actualType);
  }
  return contract.expectedType === actualType;
}

/** Get all toolIds in the matrix. */
export function getMatrixToolIds(): string[] {
  return entries.map(([id]) => id);
}

/** Get tools by role. */
export function getToolsByRole(role: PortfolioRole): [string, MutationContract][] {
  return entries.filter(([, c]) => c.role === role);
}
