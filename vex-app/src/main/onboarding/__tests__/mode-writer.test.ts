/**
 * mode-writer atomic .env write+delete tests (M11).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeMode } from "../mode-writer.js";

let dir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "vex-mode-writer-"));
  envFile = path.join(dir, ".env");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeMode", () => {
  it("chat: writes AGENT_MODE=chat, deletes AGENT_LOOP_MODE + AGENT_INITIAL_PROMPT", async () => {
    writeFileSync(
      envFile,
      'AGENT_MODE="mission"\nAGENT_LOOP_MODE="restricted"\nAGENT_INITIAL_PROMPT="old goal"\n',
    );
    const result = await writeMode({ mode: "chat" }, { envFile });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.fieldsWritten).toEqual(["AGENT_MODE"]);
    expect(result.data.fieldsDeleted).toEqual([
      "AGENT_LOOP_MODE",
      "AGENT_INITIAL_PROMPT",
    ]);
    const after = readFileSync(envFile, "utf8");
    expect(after).toContain('AGENT_MODE="chat"');
    expect(after).not.toContain("AGENT_LOOP_MODE");
    expect(after).not.toContain("AGENT_INITIAL_PROMPT");
  });

  it("mission: writes all 3 keys", async () => {
    const result = await writeMode(
      {
        mode: "mission",
        initialPrompt: "Liquidate stale tokens then report",
        loopMode: "restricted",
      },
      { envFile },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.fieldsWritten).toEqual([
      "AGENT_MODE",
      "AGENT_LOOP_MODE",
      "AGENT_INITIAL_PROMPT",
    ]);
    expect(result.data.fieldsDeleted).toEqual([]);
    const after = readFileSync(envFile, "utf8");
    expect(after).toContain('AGENT_MODE="mission"');
    expect(after).toContain('AGENT_LOOP_MODE="restricted"');
    expect(after).toContain("Liquidate stale tokens then report");
  });

  it("full_autonomous without prompt: deletes AGENT_INITIAL_PROMPT", async () => {
    writeFileSync(envFile, 'AGENT_INITIAL_PROMPT="old prompt"\n');
    const result = await writeMode({ mode: "full_autonomous" }, { envFile });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.fieldsWritten).toEqual(["AGENT_MODE"]);
    expect(result.data.fieldsDeleted).toContain("AGENT_LOOP_MODE");
    expect(result.data.fieldsDeleted).toContain("AGENT_INITIAL_PROMPT");
    const after = readFileSync(envFile, "utf8");
    expect(after).toContain('AGENT_MODE="full_autonomous"');
    expect(after).not.toContain("AGENT_INITIAL_PROMPT");
  });

  it("full_autonomous with prompt: writes prompt, deletes loop mode", async () => {
    const result = await writeMode(
      { mode: "full_autonomous", initialPrompt: "Worker seed" },
      { envFile },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.fieldsWritten).toContain("AGENT_INITIAL_PROMPT");
    expect(result.data.fieldsDeleted).toEqual(["AGENT_LOOP_MODE"]);
  });

  it("returns env_persist_failed when fs write fails", async () => {
    const result = await writeMode(
      { mode: "chat" },
      { envFile: path.join(dir, "nonexistent", "subdir", "but-not-a-dir") },
    );
    // appendMultipleToDotenvFile creates parent dirs, so we force a different
    // failure: target file path under a non-writable parent (using readonly
    // root via permissions is OS-specific; we instead point at a path where
    // a regular file already occupies the parent slot).
    writeFileSync(path.join(dir, "blocker"), "x");
    const blocked = await writeMode(
      { mode: "chat" },
      { envFile: path.join(dir, "blocker", "child") },
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("expected err");
    expect(blocked.error.code).toBe("onboarding.env_persist_failed");
    // first attempt may also fail or succeed depending on resolver; just
    // check at least one path errored
    void result;
  });
});
