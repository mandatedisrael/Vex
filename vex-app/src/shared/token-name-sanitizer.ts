/**
 * Token NAME sanitizer — sibling of `token-symbol-sanitizer.ts` for the same
 * class of attacker-influenceable display strings (`proj_balances.token_name`),
 * but for the human-readable token NAME rather than the ticker.
 *
 * The symbol grammar is too narrow for real names: `sanitizeTokenSymbol("USD
 * Coin")` returns `null` because of the internal space, which would silently
 * regress the display of one of the most common stablecoins. This sanitizer
 * widens the allowlist to cover ordinary name punctuation while keeping the
 * SAME security posture as the symbol sanitizer: ASCII-only allowlist (no
 * Unicode confusable, bidi-control, or zero-width character can ever pass,
 * because none of them are ASCII), control characters rejected outright, and
 * ONLY ASCII edge whitespace stripped — never `String.prototype.trim`, which
 * also removes exotic Unicode whitespace (crucially U+FEFF) and would let a
 * spoofing character slip past the allowlist by trimming it away. See
 * `token-symbol-sanitizer.ts` for the full rationale; that reasoning applies
 * unchanged here.
 *
 * Invalid, unsafe, empty, or over-length names return `null` — NEVER
 * truncated. A truncated name ("Wrapped Ether (fa…") can mislead a reader
 * into thinking it is the whole name; falling back to the (already
 * sanitized) symbol is safer than a partial name.
 */

import { TOKEN_SYMBOL_MAX_LENGTH } from "./token-symbol-sanitizer.js";

/** Aligned with the symbol bound: both are extracted length-bounded at the
 * same cutoff server-side and re-validated at the IPC schema boundary. Tied
 * to `TOKEN_SYMBOL_MAX_LENGTH` (not a separate literal) so the two bounds
 * can never silently drift apart. */
export const TOKEN_NAME_MAX_LENGTH = TOKEN_SYMBOL_MAX_LENGTH;

// Letters, digits, space, and ordinary name punctuation. Must start
// alphanumeric (mirrors the symbol grammar's same anchor). Every character
// in the class is plain ASCII, so control characters, bidi controls,
// zero-width characters, and Unicode confusables are rejected by
// construction — none of them belong to this class.
const SAFE_TOKEN_NAME = /^[A-Za-z0-9][A-Za-z0-9 .,'()&$_-]*$/;

// Strip ONLY ASCII surrounding whitespace — see `token-symbol-sanitizer.ts`
// for why `String.prototype.trim` is deliberately not used here.
const ASCII_EDGE_WHITESPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

/**
 * Returns the trimmed name when it is a non-empty, length-bounded, ASCII
 * allowlisted string (letters, digits, internal spaces, and `. , ' ( ) & $ _
 * -`); `null` otherwise (wrong type, empty, over-length, or containing any
 * character outside the allowlist — including control, bidi-control,
 * zero-width, and Unicode-confusable characters anywhere in the value).
 */
export function sanitizeTokenName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(ASCII_EDGE_WHITESPACE, "");
  if (trimmed.length === 0 || trimmed.length > TOKEN_NAME_MAX_LENGTH) {
    return null;
  }
  return SAFE_TOKEN_NAME.test(trimmed) ? trimmed : null;
}
