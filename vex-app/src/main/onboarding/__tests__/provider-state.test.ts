/**
 * provider-state tests (M10 codex turn 5 RED #2 fix).
 *
 * Real fs against tmpdir; verifies `probeProvider` matches engine
 * provider precedence + handles edge cases:
 *  - Explicit AGENT_PROVIDER=openrouter + key+model → configured.
 *  - Explicit AGENT_PROVIDER=openrouter + key only → not configured.
 *  - Explicit AGENT_PROVIDER=bogus → not configured (engine returns null).
 *  - AGENT_PROVIDER absent + key+model → fallback to openrouter.
 *  - Empty quoted key `OPENROUTER_API_KEY=""` → treated as not configured.
 *  - Nothing configured → null.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let tmpDir = "";
let envFile = "";

vi.mock("../../paths/config-dir.ts", () => ({
  get CONFIG_DIR() {
    return tmpDir;
  },
  get ENV_FILE() {
    return envFile;
  },
}));

const { probeProvider } = await import("../provider-state.js");

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-provider-state-"));
  envFile = path.join(tmpDir, ".env");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function writeEnv(content: string): void {
  writeFileSync(envFile, content, { mode: 0o600 });
}

describe("probeProvider", () => {
  it("returns name:null when env file is missing", async () => {
    const r = await probeProvider(envFile);
    expect(r).toEqual({ configured: false, name: null, modelLabel: null });
  });

  it("explicit AGENT_PROVIDER=openrouter + key + model → configured", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        'AGENT_MODEL="anthropic/claude-sonnet-4.5"',
        'AGENT_PROVIDER="openrouter"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(true);
    expect(r.name).toBe("openrouter");
    expect(r.modelLabel).toBe("anthropic/claude-sonnet-4.5");
  });

  it("explicit AGENT_PROVIDER=openrouter + key only (no model) → NOT configured", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        'AGENT_PROVIDER="openrouter"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(false);
    expect(r.name).toBe("openrouter");
    expect(r.modelLabel).toBe(null);
  });

  it("explicit AGENT_PROVIDER=bogus → NOT configured (engine fails closed)", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        'AGENT_MODEL="anthropic/claude-sonnet-4.5"',
        'AGENT_PROVIDER="bogus-provider"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    // MUST fail closed — would mislead the wizard otherwise.
    expect(r.configured).toBe(false);
    expect(r.name).toBe(null);
    expect(r.modelLabel).toBe(null);
  });

  it("AGENT_PROVIDER absent + key + model → fallback to openrouter", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        'AGENT_MODEL="anthropic/claude-sonnet-4.5"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(true);
    expect(r.name).toBe("openrouter");
    expect(r.modelLabel).toBe("anthropic/claude-sonnet-4.5");
  });

  it("empty quoted OPENROUTER_API_KEY=\"\" → treated as not configured", async () => {
    writeEnv(
      [
        'OPENROUTER_API_KEY=""',
        'AGENT_MODEL="anthropic/claude-sonnet-4.5"',
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(false);
    expect(r.name).toBe(null);
  });

  it("modelLabel > 200 chars truncated", async () => {
    const longModel = "x".repeat(300);
    writeEnv(
      [
        'OPENROUTER_API_KEY="sk-or-test"',
        `AGENT_MODEL="${longModel}"`,
      ].join("\n") + "\n",
    );
    const r = await probeProvider(envFile);
    expect(r.configured).toBe(true);
    expect(r.modelLabel?.length).toBe(200);
  });
});
