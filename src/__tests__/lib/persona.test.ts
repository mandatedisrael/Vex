import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsePersona,
  loadPersona,
  DEFAULT_PERSONA_NAME,
} from "../../lib/persona.js";

describe("parsePersona", () => {
  it("returns the default (unconfigured) persona for empty / whitespace-only input", () => {
    expect(parsePersona("")).toEqual({ name: DEFAULT_PERSONA_NAME, block: null, configured: false });
    expect(parsePersona("   \n\n  \t ")).toEqual({ name: DEFAULT_PERSONA_NAME, block: null, configured: false });
  });

  it("extracts a leading `name:` line and treats the remainder as the body", () => {
    const p = parsePersona("name: Aria\n\nTone: concise, dry.\nAlways state risk.");
    expect(p.name).toBe("Aria");
    expect(p.block).toBe("Tone: concise, dry.\nAlways state risk.");
  });

  it("accepts `name:` with no space and no body (block stays null)", () => {
    expect(parsePersona("name:Bob")).toEqual({ name: "Bob", block: null, configured: true });
  });

  it("treats a name-only file as CONFIGURED (so the setup offer never fires)", () => {
    expect(parsePersona("name: Aria")).toEqual({ name: "Aria", block: null, configured: true });
  });

  it("treats a body-only file as configured", () => {
    expect(parsePersona("Just a body").configured).toBe(true);
  });

  it("keeps the default name when there is no leading `name:` line (all body)", () => {
    const p = parsePersona("Just a persona description.\nSecond line.");
    expect(p.name).toBe(DEFAULT_PERSONA_NAME);
    expect(p.block).toBe("Just a persona description.\nSecond line.");
  });

  it("ignores leading blank lines when locating the name", () => {
    const p = parsePersona("\n\n  name: Cy \n\nbody text");
    expect(p.name).toBe("Cy");
    expect(p.block).toBe("body text");
  });

  it("caps the name length", () => {
    const p = parsePersona(`name: ${"a".repeat(40)}\nbody`);
    expect(p.name.length).toBe(24);
  });

  it("caps the body to a bounded number of lines", () => {
    const body = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const p = parsePersona(body);
    expect(p.block).not.toBeNull();
    expect(p.block!.split("\n").length).toBeLessThanOrEqual(120);
  });

  it("caps the body to a bounded number of characters", () => {
    const p = parsePersona("y".repeat(5000));
    expect(p.block).not.toBeNull();
    expect(p.block!.length).toBeLessThanOrEqual(4000);
  });
});

describe("loadPersona", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("returns the default persona when the file does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "vex-persona-"));
    expect(loadPersona(join(dir, "persona.md"))).toEqual({
      name: DEFAULT_PERSONA_NAME,
      block: null,
      configured: false,
    });
  });

  it("reads and parses an existing persona file", () => {
    dir = mkdtempSync(join(tmpdir(), "vex-persona-"));
    const file = join(dir, "persona.md");
    writeFileSync(file, "name: Nova\n\nBe terse. No emoji.", "utf-8");
    expect(loadPersona(file)).toEqual({ name: "Nova", block: "Be terse. No emoji.", configured: true });
  });
});
