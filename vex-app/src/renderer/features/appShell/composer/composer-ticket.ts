/**
 * Pure copy helper for the Order Ticket header microbar (see
 * `SessionComposer` + `composer/TicketChrome.tsx`).
 *
 * The eyebrow is a mono microlabel that names the instrument's current
 * context. It is derived ENTIRELY from state the composer already holds
 * (approval echo, plan mode, welcome/stage presence, and the active row's
 * `mode`) — no new data plumbing. Kept pure + separate so the label logic
 * is unit-testable without mounting the composer.
 */

import type { SessionListItem } from "@shared/schemas/sessions.js";

export interface TicketEyebrowInput {
  /** A mission run parked for approval (`runStatus === "paused_approval"`). */
  readonly awaitingApproval: boolean;
  /** Plan mode is on for the active session. */
  readonly planOn: boolean;
  /** Null on the welcome screen (no open session yet). */
  readonly sessionId: string | null;
  /** Welcome/idle stage presence (presentation only). */
  readonly stage: boolean;
  /** The active row, when a detail query has resolved one. */
  readonly session: SessionListItem | null;
}

/**
 * The header microbar label. Precedence: approval echo → plan mode →
 * welcome/stage → the active row's mode. Every branch resolves to a short
 * uppercase mono string (the caller renders it verbatim).
 */
export function ticketEyebrowLabel(input: TicketEyebrowInput): string {
  if (input.awaitingApproval) return "AWAITING YOUR SIGNATURE";
  if (input.planOn) return "PLAN MODE";
  if (input.stage || input.sessionId === null || input.session === null) {
    return "MISSION INPUT";
  }
  return input.session.mode === "mission" ? "MISSION INPUT" : "AGENT INPUT";
}
