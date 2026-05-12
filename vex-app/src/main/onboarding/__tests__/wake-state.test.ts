/**
 * wake-state probe coherence tests (M11 D13).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { probeWake } from "../wake-state.js";

let dir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "vex-wake-state-"));
  envFile = path.join(dir, ".env");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("probeWake", () => {
  it("missing .env: enabled=false, coherent=false", async () => {
    const result = await probeWake({ envFile });
    expect(result.enabled).toBe(false);
    expect(result.coherent).toBe(false);
  });

  it("enabled=false explicitly: coherent=true", async () => {
    writeFileSync(envFile, 'AGENT_WAKE_ENABLED="false"\n');
    const result = await probeWake({ envFile });
    expect(result.enabled).toBe(false);
    expect(result.coherent).toBe(true);
  });

  it("enabled=true with valid range: coherent=true", async () => {
    writeFileSync(
      envFile,
      'AGENT_WAKE_ENABLED="true"\nAGENT_WAKE_INTERVAL_MS="2000"\nAGENT_WAKE_BATCH_SIZE="10"\n',
    );
    const result = await probeWake({ envFile });
    expect(result.enabled).toBe(true);
    expect(result.intervalMs).toBe(2000);
    expect(result.batchSize).toBe(10);
    expect(result.coherent).toBe(true);
  });

  it("enabled=true with out-of-range interval: coherent=false", async () => {
    writeFileSync(
      envFile,
      'AGENT_WAKE_ENABLED="true"\nAGENT_WAKE_INTERVAL_MS="999999"\nAGENT_WAKE_BATCH_SIZE="10"\n',
    );
    const result = await probeWake({ envFile });
    expect(result.intervalMs).toBeNull();
    expect(result.coherent).toBe(false);
  });

  it("enabled=true with missing batch: coherent=false", async () => {
    writeFileSync(
      envFile,
      'AGENT_WAKE_ENABLED="true"\nAGENT_WAKE_INTERVAL_MS="2000"\n',
    );
    const result = await probeWake({ envFile });
    expect(result.batchSize).toBeNull();
    expect(result.coherent).toBe(false);
  });

  it("invalid AGENT_WAKE_ENABLED literal: enabled=false, coherent=false", async () => {
    writeFileSync(envFile, 'AGENT_WAKE_ENABLED="maybe"\n');
    const result = await probeWake({ envFile });
    expect(result.enabled).toBe(false);
    expect(result.coherent).toBe(false);
  });
});
