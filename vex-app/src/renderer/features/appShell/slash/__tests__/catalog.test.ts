/**
 * Slash catalog tests (stage 8-6a). Pins the menu's matching rule and the
 * two-way drift guard against the parser + label table.
 */

import { describe, expect, it } from "vitest";
import {
  SLASH_COMMAND_CATALOG,
  filterSlashCatalog,
  slashCommandList,
} from "../catalog.js";
import { SLASH_COMMAND_LABEL, type SlashCommand } from "../types.js";
import { parseSlashCommand } from "../parser.js";

describe("slash catalog (8-6a)", () => {
  it("filters by leading-trimmed, case-insensitive template prefix", () => {
    expect(filterSlashCatalog("/")).toHaveLength(SLASH_COMMAND_CATALOG.length);
    expect(filterSlashCatalog("/re").map((e) => e.kind).sort()).toEqual(
      ["restore", "retry", "rewind"].sort(),
    );
    expect(filterSlashCatalog("/REW").map((e) => e.kind)).toEqual(["rewind"]);
    // Trailing space narrows `/mission ` to the verbs (excludes mission-renew).
    expect(filterSlashCatalog("/mission ").map((e) => e.kind)).toEqual([
      "mission-start",
      "mission-continue",
      "mission-recover",
      "mission-stop",
      "mission-edit",
    ]);
    expect(filterSlashCatalog("hello")).toEqual([]);
    expect(filterSlashCatalog("/nope")).toEqual([]);
    expect(filterSlashCatalog("")).toEqual([]);
  });

  it("every catalog template parses to its command (no offer the parser rejects)", () => {
    for (const entry of SLASH_COMMAND_CATALOG) {
      // Arg-taking templates end with a space; supply a sample value.
      const input = entry.template.endsWith(" ")
        ? `${entry.template}3`
        : entry.template;
      const parsed = parseSlashCommand(input);
      expect(parsed.kind, `${entry.template} -> ${JSON.stringify(parsed)}`).toBe(
        "ok",
      );
      if (parsed.kind === "ok") {
        expect(parsed.command.kind).toBe(entry.kind);
      }
    }
  });

  it("covers every SlashCommand kind exactly once (no drift)", () => {
    const kinds = SLASH_COMMAND_CATALOG.map((e) => e.kind).sort();
    const labelKinds = (
      Object.keys(SLASH_COMMAND_LABEL) as SlashCommand["kind"][]
    ).sort();
    expect(kinds).toEqual(labelKinds);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("agent mode hides mission-only commands; mission mode offers them all", () => {
    expect(
      filterSlashCatalog("/", "agent")
        .map((e) => e.kind)
        .sort(),
    ).toEqual(["restore", "retry", "rewind"].sort());
    expect(filterSlashCatalog("/", "mission")).toHaveLength(
      SLASH_COMMAND_CATALOG.length,
    );
    // Mode filter composes with the prefix filter.
    expect(filterSlashCatalog("/mission ", "agent")).toEqual([]);
  });

  it("slashCommandList advertises exactly the mode's commands", () => {
    expect(slashCommandList("agent")).toBe("/retry, /rewind <N>, /restore");
    const mission = slashCommandList("mission");
    expect(mission).toContain("/mission start");
    expect(mission).toContain("/rewind <N>"); // arg annotated, shared across modes
    expect(slashCommandList("agent")).not.toContain("/mission");
  });
});
