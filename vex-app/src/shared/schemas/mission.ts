/**
 * Mission schemas barrel — splits the original monolith into
 * `mission/draft.ts` (read-only DTO + acceptance projection),
 * `mission/commands.ts` (9 per-command discriminated unions), and
 * `mission/results.ts` (WP-J: the read-only mission results ledger DTO).
 *
 * The split keeps each file under the project's 350-LOC budget per
 * the puzzle-04 phase-6 codex review.
 *
 * The historical generic `missionCommandInputSchema` /
 * `missionCommandResultSchema` envelopes are intentionally NOT
 * re-exported — phase 6 removes them in favour of typed per-command
 * pairs.
 */

export * from "./mission/draft.js";
export * from "./mission/commands.js";
export * from "./mission/results.js";
