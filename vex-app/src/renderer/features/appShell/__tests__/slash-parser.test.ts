/**
 * Slash command parser unit tests (puzzle 04 phase 7).
 *
 * Pure function tests: every input → expected `ParseResult`. The
 * parser is the only renderer-side validation layer for destructive
 * commands — engine re-validates at the IPC boundary, but a strict
 * parser keeps friendly composer copy + avoids round-trips for
 * obvious nonsense (`/rewind abc`, `/mission stop reason`).
 */

import { describe, expect, it } from "vitest";

import { parseSlashCommand } from "../slash/parser.js";

describe("parseSlashCommand", () => {
  describe("not-a-command", () => {
    it("classifies plain text as not-a-command", () => {
      expect(parseSlashCommand("hello vex").kind).toBe("not-a-command");
    });

    it("classifies leading whitespace then text as not-a-command", () => {
      expect(parseSlashCommand("   hello").kind).toBe("not-a-command");
    });

    it("classifies empty string as not-a-command", () => {
      expect(parseSlashCommand("").kind).toBe("not-a-command");
    });

    it("classifies whitespace-only string as not-a-command", () => {
      expect(parseSlashCommand("   \t\n  ").kind).toBe("not-a-command");
    });

    it("rejects a slash mid-word as not-a-command", () => {
      expect(parseSlashCommand("ratio 1/2 vs 3/4").kind).toBe("not-a-command");
    });
  });

  describe("unknown", () => {
    it("returns unknown for a leading slash with an unrecognised head", () => {
      const result = parseSlashCommand("/foobar");
      expect(result.kind).toBe("unknown");
      if (result.kind === "unknown") expect(result.raw).toBe("/foobar");
    });

    it("returns unknown for /mission with an unrecognised verb", () => {
      const result = parseSlashCommand("/mission yeet");
      expect(result.kind).toBe("unknown");
    });
  });

  describe("/mission start|continue|recover|stop|edit", () => {
    it("parses /mission start (no confirm)", () => {
      const result = parseSlashCommand("/mission start");
      expect(result).toEqual({
        kind: "ok",
        command: { kind: "mission-start" },
        requiresConfirm: false,
      });
    });

    it("parses /mission continue (no confirm)", () => {
      const result = parseSlashCommand("/mission continue");
      expect(result).toMatchObject({
        kind: "ok",
        command: { kind: "mission-continue" },
        requiresConfirm: false,
      });
    });

    it("parses /mission recover (no confirm)", () => {
      const result = parseSlashCommand("/mission recover");
      expect(result).toMatchObject({
        kind: "ok",
        command: { kind: "mission-recover" },
        requiresConfirm: false,
      });
    });

    it("parses /mission stop (no confirm, no args)", () => {
      const result = parseSlashCommand("/mission stop");
      expect(result).toMatchObject({
        kind: "ok",
        command: { kind: "mission-stop" },
        requiresConfirm: false,
      });
    });

    it("REJECTS /mission stop with extra args (schema has no reason field)", () => {
      // Codex phase 7 review #2: shared schema is { sessionId } only.
      const result = parseSlashCommand("/mission stop ran out of budget");
      expect(result.kind).toBe("invalid");
      if (result.kind === "invalid") {
        expect(result.reason).toBe("/mission stop takes no arguments.");
      }
    });

    it("parses /mission edit (no confirm; downstream is still fail-closed)", () => {
      const result = parseSlashCommand("/mission edit");
      expect(result).toMatchObject({
        kind: "ok",
        command: { kind: "mission-edit" },
        requiresConfirm: false,
      });
    });

    it("rejects /mission start with extra args", () => {
      const result = parseSlashCommand("/mission start now");
      expect(result.kind).toBe("invalid");
    });

    it("rejects bare /mission as invalid", () => {
      const result = parseSlashCommand("/mission");
      expect(result.kind).toBe("invalid");
    });

    it("is case-insensitive on the head and verb", () => {
      expect(parseSlashCommand("/Mission Start")).toMatchObject({
        kind: "ok",
        command: { kind: "mission-start" },
      });
    });
  });

  describe("/retry", () => {
    it("parses /retry as a no-confirm command", () => {
      const result = parseSlashCommand("/retry");
      expect(result).toEqual({
        kind: "ok",
        command: { kind: "retry" },
        requiresConfirm: false,
      });
    });

    it("rejects /retry with extra args", () => {
      expect(parseSlashCommand("/retry now").kind).toBe("invalid");
    });
  });

  describe("/rewind <N>", () => {
    it("parses /rewind 3 as a confirmation-gated rewind", () => {
      const result = parseSlashCommand("/rewind 3");
      expect(result).toEqual({
        kind: "ok",
        command: { kind: "rewind", turns: 3 },
        requiresConfirm: true,
      });
    });

    it("parses /rewind 50 (upper bound, valid)", () => {
      const result = parseSlashCommand("/rewind 50");
      expect(result).toMatchObject({
        kind: "ok",
        command: { kind: "rewind", turns: 50 },
      });
    });

    it("parses /rewind 1 (lower bound, valid)", () => {
      const result = parseSlashCommand("/rewind 1");
      expect(result).toMatchObject({
        kind: "ok",
        command: { kind: "rewind", turns: 1 },
      });
    });

    it("rejects /rewind 0 (below engine schema minimum)", () => {
      const result = parseSlashCommand("/rewind 0");
      expect(result.kind).toBe("invalid");
      if (result.kind === "invalid") {
        expect(result.reason).toMatch(/1\.\.50/);
      }
    });

    it("rejects /rewind 51 (above engine schema maximum)", () => {
      const result = parseSlashCommand("/rewind 51");
      expect(result.kind).toBe("invalid");
    });

    it("rejects /rewind without N", () => {
      expect(parseSlashCommand("/rewind").kind).toBe("invalid");
    });

    it("rejects /rewind with non-integer N", () => {
      expect(parseSlashCommand("/rewind abc").kind).toBe("invalid");
      expect(parseSlashCommand("/rewind 3.5").kind).toBe("invalid");
      expect(parseSlashCommand("/rewind -3").kind).toBe("invalid");
      expect(parseSlashCommand("/rewind +3").kind).toBe("invalid");
    });

    it("rejects /rewind with multiple args", () => {
      expect(parseSlashCommand("/rewind 3 turns").kind).toBe("invalid");
    });
  });

  describe("/restore + /mission-renew (confirmation gated)", () => {
    it("parses /restore with requiresConfirm=true", () => {
      const result = parseSlashCommand("/restore");
      expect(result).toEqual({
        kind: "ok",
        command: { kind: "restore" },
        requiresConfirm: true,
      });
    });

    it("rejects /restore with extra args", () => {
      expect(parseSlashCommand("/restore now").kind).toBe("invalid");
    });

    it("parses /mission-renew with requiresConfirm=true", () => {
      const result = parseSlashCommand("/mission-renew");
      expect(result).toEqual({
        kind: "ok",
        command: { kind: "mission-renew" },
        requiresConfirm: true,
      });
    });

    it("rejects /mission-renew with extra args", () => {
      expect(parseSlashCommand("/mission-renew force").kind).toBe("invalid");
    });
  });

  describe("trimming + edge cases", () => {
    it("trims surrounding whitespace before parsing", () => {
      expect(parseSlashCommand("   /restore   ")).toMatchObject({
        kind: "ok",
        command: { kind: "restore" },
      });
    });

    it("collapses internal whitespace via /\\s+/", () => {
      expect(parseSlashCommand("/mission   start")).toMatchObject({
        kind: "ok",
        command: { kind: "mission-start" },
      });
    });

    it("returns invalid (not unknown) for /  (empty body after slash)", () => {
      expect(parseSlashCommand("/   ").kind).toBe("invalid");
    });
  });
});
