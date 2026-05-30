/**
 * Slash command catalog (stage 8-6a) — the single data source for the
 * discoverable composer menu. Each entry maps a `SlashCommand["kind"]` to the
 * literal text inserted into the composer (`template`), a short label/hint,
 * and whether it is destructive (mirrors the parser's confirmation gate).
 *
 * `filterSlashCatalog` is pure so the menu hook and its tests share one
 * matching rule. `catalog.test.ts` pins BOTH directions — every template
 * parses, and every `SlashCommand` kind has exactly one entry — so the menu
 * can never offer a command the parser rejects, and a new command kind fails
 * the test until it is listed here.
 */

import type { SessionMode } from "@shared/schemas/sessions.js";
import { SLASH_COMMAND_LABEL, type SlashCommand } from "./types.js";

export interface SlashCatalogEntry {
  readonly kind: SlashCommand["kind"];
  /**
   * Literal text inserted into the composer when the entry is chosen.
   * Arg-taking commands end with a trailing space (e.g. `/rewind `) so the
   * caret lands ready for the value.
   */
  readonly template: string;
  readonly label: string;
  readonly hint: string;
  /** Destructive/lineage-altering → the composer runs the confirm dialog. */
  readonly destructive: boolean;
  /**
   * Session modes this command is offered in. Mission-loop commands are
   * mission-only; transcript ops (`/retry`, `/rewind`, `/restore`) apply to
   * both. The menu, the under-input hint, and the unknown-command suggestion
   * all derive their advertised set from this field, so an agent session never
   * surfaces a `/mission *` command it cannot run.
   */
  readonly modes: readonly SessionMode[];
}

const MISSION_ONLY: readonly SessionMode[] = ["mission"];
const ALL_MODES: readonly SessionMode[] = ["agent", "mission"];

export const SLASH_COMMAND_CATALOG: readonly SlashCatalogEntry[] = [
  {
    kind: "mission-start",
    template: "/mission start",
    label: SLASH_COMMAND_LABEL["mission-start"],
    hint: "Start the accepted mission",
    destructive: false,
    modes: MISSION_ONLY,
  },
  {
    kind: "mission-continue",
    template: "/mission continue",
    label: SLASH_COMMAND_LABEL["mission-continue"],
    hint: "Resume the mission loop",
    destructive: false,
    modes: MISSION_ONLY,
  },
  {
    kind: "mission-recover",
    template: "/mission recover",
    label: SLASH_COMMAND_LABEL["mission-recover"],
    hint: "Recover after an error",
    destructive: false,
    modes: MISSION_ONLY,
  },
  {
    kind: "mission-stop",
    template: "/mission stop",
    label: SLASH_COMMAND_LABEL["mission-stop"],
    hint: "Stop the active run",
    destructive: false,
    modes: MISSION_ONLY,
  },
  {
    kind: "mission-edit",
    template: "/mission edit",
    label: SLASH_COMMAND_LABEL["mission-edit"],
    hint: "Edit the mission draft",
    destructive: false,
    modes: MISSION_ONLY,
  },
  {
    kind: "retry",
    template: "/retry",
    label: SLASH_COMMAND_LABEL["retry"],
    hint: "Re-run the last step after a failure",
    destructive: false,
    modes: ALL_MODES,
  },
  {
    kind: "rewind",
    template: "/rewind ",
    label: SLASH_COMMAND_LABEL["rewind"],
    hint: "Archive recent turns back to a chosen point (you can /restore them)",
    destructive: true,
    modes: ALL_MODES,
  },
  {
    kind: "restore",
    template: "/restore",
    label: SLASH_COMMAND_LABEL["restore"],
    hint: "Bring back the turns from the most recent /rewind",
    destructive: true,
    modes: ALL_MODES,
  },
  {
    kind: "mission-renew",
    template: "/mission-renew",
    label: SLASH_COMMAND_LABEL["mission-renew"],
    hint: "New draft from the last contract",
    destructive: true,
    modes: MISSION_ONLY,
  },
];

/**
 * Entries whose `template` starts with the (leading-trimmed, lowercased) draft
 * AND that are offered in `mode`. Returns `[]` when the draft is not a slash
 * query. Leading whitespace is ignored; a trailing space is significant (so
 * `/mission ` narrows to the verbs and excludes `/mission-renew`). When `mode`
 * is omitted no mode filter is applied (every matching command is returned).
 */
export function filterSlashCatalog(
  draft: string,
  mode?: SessionMode,
): readonly SlashCatalogEntry[] {
  const query = draft.replace(/^\s+/, "").toLowerCase();
  if (query.length === 0 || query[0] !== "/") return [];
  return SLASH_COMMAND_CATALOG.filter(
    (entry) =>
      entry.template.toLowerCase().startsWith(query) &&
      (mode === undefined || entry.modes.includes(mode)),
  );
}

/** Display token for the under-input hint / suggestions (annotates args). */
function hintToken(entry: SlashCatalogEntry): string {
  return entry.kind === "rewind" ? "/rewind <N>" : entry.template.trim();
}

/**
 * Comma-joined list of the slash commands available in `mode`, e.g.
 * `"/retry, /rewind <N>, /restore"` for an agent session. Single source for
 * the composer's under-input hint AND its unknown-command suggestion, so we
 * never advertise a command the current mode hides from the menu.
 */
export function slashCommandList(mode: SessionMode): string {
  return SLASH_COMMAND_CATALOG.filter((entry) => entry.modes.includes(mode))
    .map(hintToken)
    .join(", ");
}
