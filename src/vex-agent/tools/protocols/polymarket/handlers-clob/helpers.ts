/**
 * Polymarket CLOB handlers — shared private helpers.
 *
 * `splitIds` is shared by the market-data and order group modules
 * (single source of truth per Team Standards §2.3).
 */

export function splitIds(raw: string): string[] {
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
