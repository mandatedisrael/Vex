/**
 * Polymarket shared helpers — pure JSON parsers.
 * Extracted from commands/polymarket/helpers.ts for retained core.
 */

/** Parse outcomes JSON string → [YES price, NO price]. */
export function parseOutcomePrices(outcomePrices: string | null): { yes: number; no: number } {
  if (!outcomePrices) return { yes: 0, no: 0 };
  try {
    const parsed = JSON.parse(outcomePrices);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return { yes: parseFloat(parsed[0]) || 0, no: parseFloat(parsed[1]) || 0 };
    }
  } catch { /* ignore */ }
  return { yes: 0, no: 0 };
}

/** Parse outcomes JSON string → ["Yes", "No"]. */
export function parseOutcomes(outcomes: string | null): string[] {
  if (!outcomes) return ["Yes", "No"];
  try {
    const parsed = JSON.parse(outcomes);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return ["Yes", "No"];
}

/** Parse clobTokenIds JSON string → [yesTokenId, noTokenId]. */
export function parseClobTokenIds(clobTokenIds: string | null): { yes: string; no: string } {
  if (!clobTokenIds) return { yes: "", no: "" };
  try {
    const parsed = JSON.parse(clobTokenIds);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return { yes: parsed[0], no: parsed[1] };
    }
  } catch { /* ignore */ }
  return { yes: "", no: "" };
}
