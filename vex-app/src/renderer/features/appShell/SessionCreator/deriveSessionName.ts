/**
 * Pure session-name seed helper for the New-session modal (extracted from
 * `SessionCreator.tsx`).
 */

import { SESSION_TITLE_MAX_LENGTH } from "@shared/schemas/sessions.js";

/**
 * Deterministic session name seeded from the first message typed in the
 * welcome composer (welcome→create flow). Whitespace-collapsed + capped so it
 * satisfies the `name` min(1) requirement; the user can still edit it.
 */
export function deriveSessionName(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.min(48, SESSION_TITLE_MAX_LENGTH));
}
