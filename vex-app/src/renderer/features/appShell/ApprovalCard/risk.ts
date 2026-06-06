/**
 * Risk classification helpers for `ApprovalCard` (F3 — SECURITY-relevant).
 *
 * Pure functions / constants extracted from `ApprovalCard.tsx` VERBATIM. These
 * decide whether an approval is "high-risk" (which arms the two-step confirm
 * gate in the component) and the chip styling for the risk badge. They carry
 * NO React state and own NO decision side effects — the confirm gating itself
 * stays in `ApprovalCard` so the two-click guard is never weakened.
 */

import type { ApprovalSummaryDto } from "@shared/schemas/approvals.js";

export const HIGH_RISK_LEVELS = new Set(["high", "critical"]);
export const HIGH_RISK_ACTION_KINDS = new Set([
  "destructive",
  "user_wallet_broadcast",
]);

/**
 * High-risk when `riskLevel ∈ {high,critical}` OR
 * `actionKind ∈ {destructive,user_wallet_broadcast}`. Mirrors the original
 * inline `useMemo` body exactly so the security gate is unchanged.
 */
export function isHighRisk(summary: ApprovalSummaryDto): boolean {
  if (summary.riskLevel !== null && HIGH_RISK_LEVELS.has(summary.riskLevel)) {
    return true;
  }
  if (
    summary.actionKind !== null &&
    HIGH_RISK_ACTION_KINDS.has(summary.actionKind)
  ) {
    return true;
  }
  return false;
}

export function riskChipClasses(level: string): string {
  switch (level) {
    case "critical":
      return "border border-red-500/40 bg-red-500/10 text-red-300";
    case "high":
      return "border border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "medium":
      return "border border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
    case "low":
      return "border border-blue-500/30 bg-blue-500/10 text-blue-300";
    default:
      return "border border-white/[0.10] bg-white/[0.05]";
  }
}
