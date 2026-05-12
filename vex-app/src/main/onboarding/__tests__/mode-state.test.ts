/**
 * mode-state probe coherence tests (M11 D13).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { probeMode } from "../mode-state.js";

let dir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "vex-mode-state-"));
  envFile = path.join(dir, ".env");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("probeMode", () => {
  it("missing .env: returns coherent=false, all null", async () => {
    const result = await probeMode({ envFile });
    expect(result.selected).toBeNull();
    expect(result.loopMode).toBeNull();
    expect(result.hasInitialPrompt).toBe(false);
    expect(result.coherent).toBe(false);
  });

  it("chat: coherent=true regardless of loop/prompt", async () => {
    writeFileSync(envFile, 'AGENT_MODE="chat"\n');
    const result = await probeMode({ envFile });
    expect(result.selected).toBe("chat");
    expect(result.coherent).toBe(true);
  });

  it("mission with all 3 valid: coherent=true", async () => {
    writeFileSync(
      envFile,
      'AGENT_MODE="mission"\nAGENT_LOOP_MODE="restricted"\nAGENT_INITIAL_PROMPT="Liquidate stale tokens"\n',
    );
    const result = await probeMode({ envFile });
    expect(result.coherent).toBe(true);
    expect(result.selected).toBe("mission");
    expect(result.loopMode).toBe("restricted");
    expect(result.hasInitialPrompt).toBe(true);
  });

  it("mission missing initialPrompt: coherent=false (no skip)", async () => {
    writeFileSync(
      envFile,
      'AGENT_MODE="mission"\nAGENT_LOOP_MODE="restricted"\n',
    );
    const result = await probeMode({ envFile });
    expect(result.coherent).toBe(false);
  });

  it("mission with too-short prompt: coherent=false", async () => {
    writeFileSync(
      envFile,
      'AGENT_MODE="mission"\nAGENT_LOOP_MODE="restricted"\nAGENT_INITIAL_PROMPT="hi"\n',
    );
    const result = await probeMode({ envFile });
    expect(result.coherent).toBe(false);
  });

  it("mission with invalid loop enum: coherent=false", async () => {
    writeFileSync(
      envFile,
      'AGENT_MODE="mission"\nAGENT_LOOP_MODE="bogus"\nAGENT_INITIAL_PROMPT="Long enough prompt"\n',
    );
    const result = await probeMode({ envFile });
    expect(result.loopMode).toBeNull();
    expect(result.coherent).toBe(false);
  });

  it("full_autonomous: coherent=true with or without prompt", async () => {
    writeFileSync(envFile, 'AGENT_MODE="full_autonomous"\n');
    const result = await probeMode({ envFile });
    expect(result.selected).toBe("full_autonomous");
    expect(result.coherent).toBe(true);
  });

  it("invalid AGENT_MODE value: coherent=false, selected=null", async () => {
    writeFileSync(envFile, 'AGENT_MODE="autopilot"\n');
    const result = await probeMode({ envFile });
    expect(result.selected).toBeNull();
    expect(result.coherent).toBe(false);
  });
});
