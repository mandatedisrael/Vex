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
}

export const SLASH_COMMAND_CATALOG: readonly SlashCatalogEntry[] = [
  {
    kind: "mission-start",
    template: "/mission start",
    label: SLASH_COMMAND_LABEL["mission-start"],
    hint: "Start the accepted mission",
    destructive: false,
  },
  {
    kind: "mission-continue",
    template: "/mission continue",
    label: SLASH_COMMAND_LABEL["mission-continue"],
    hint: "Resume the mission loop",
    destructive: false,
  },
  {
    kind: "mission-recover",
    template: "/mission recover",
    label: SLASH_COMMAND_LABEL["mission-recover"],
    hint: "Recover after an error",
    destructive: false,
  },
  {
    kind: "mission-stop",
    template: "/mission stop",
    label: SLASH_COMMAND_LABEL["mission-stop"],
    hint: "Stop the active run",
    destructive: false,
  },
  {
    kind: "mission-edit",
    template: "/mission edit",
    label: SLASH_COMMAND_LABEL["mission-edit"],
    hint: "Edit the mission draft",
    destructive: false,
  },
  {
    kind: "retry",
    template: "/retry",
    label: SLASH_COMMAND_LABEL["retry"],
    hint: "Retry the last step",
    destructive: false,
  },
  {
    kind: "rewind",
    template: "/rewind ",
    label: SLASH_COMMAND_LABEL["rewind"],
    hint: "Archive the last N user turns",
    destructive: true,
  },
  {
    kind: "restore",
    template: "/restore",
    label: SLASH_COMMAND_LABEL["restore"],
    hint: "Restore the last rewind",
    destructive: true,
  },
  {
    kind: "mission-renew",
    template: "/mission-renew",
    label: SLASH_COMMAND_LABEL["mission-renew"],
    hint: "New draft from the last contract",
    destructive: true,
  },
];

/**
 * Entries whose `template` starts with the (leading-trimmed, lowercased)
 * draft. Returns `[]` when the draft is not a slash query. Leading whitespace
 * is ignored; a trailing space is significant (so `/mission ` narrows to the
 * verbs and excludes `/mission-renew`).
 */
export function filterSlashCatalog(
  draft: string,
): readonly SlashCatalogEntry[] {
  const query = draft.replace(/^\s+/, "").toLowerCase();
  if (query.length === 0 || query[0] !== "/") return [];
  return SLASH_COMMAND_CATALOG.filter((entry) =>
    entry.template.toLowerCase().startsWith(query),
  );
}
