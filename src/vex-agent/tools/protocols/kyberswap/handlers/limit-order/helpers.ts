/**
 * KyberSwap limit order shared helpers — duration parsing.
 *
 * Single-sourced helper consumed by the limit-order create handler.
 * Behavior unchanged.
 */

// ── Duration parser ──────────────────────────────────────────────

export function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid duration: ${input}. Use: 1h, 24h, 7d, 30d`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 3600;
  if (unit === "d") return value * 86400;
  throw new Error(`Invalid duration unit: ${unit}`);
}
