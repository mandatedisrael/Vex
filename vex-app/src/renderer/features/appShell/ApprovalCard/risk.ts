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

/**
 * Stamp-grammar tone classes (S3): hairline color-mix border + text in tone;
 * fill is reserved for danger (`critical` only, at /10). The caller supplies
 * the shared stamp shape (radius/spacing/type) — these add tone only.
 */
export function riskChipClasses(level: string): string {
  switch (level) {
    case "critical":
      return "border-[color-mix(in_oklab,var(--color-destructive)_40%,transparent)] bg-destructive/10 text-destructive";
    case "high":
      return "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-warning";
    case "medium":
      return "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-warning";
    case "low":
      return "border-[color-mix(in_oklab,var(--vex-accent)_40%,transparent)] text-[var(--vex-accent-text)]";
    default:
      return "border-[var(--vex-line-strong)] text-[var(--vex-text-2)]";
  }
}
