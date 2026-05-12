/**
 * wake-writer atomic .env write+delete tests (M11).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeWake } from "../wake-writer.js";

let dir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "vex-wake-writer-"));
  envFile = path.join(dir, ".env");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeWake", () => {
  it("enabled=true: writes all 3 keys atomically", async () => {
    const result = await writeWake(
      { enabled: true, intervalMs: 1500, batchSize: 5 },
      { envFile },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.fieldsWritten).toEqual([
      "AGENT_WAKE_ENABLED",
      "AGENT_WAKE_INTERVAL_MS",
      "AGENT_WAKE_BATCH_SIZE",
    ]);
    expect(result.data.fieldsDeleted).toEqual([]);
    const after = readFileSync(envFile, "utf8");
    expect(after).toContain('AGENT_WAKE_ENABLED="true"');
    expect(after).toContain('AGENT_WAKE_INTERVAL_MS="1500"');
    expect(after).toContain('AGENT_WAKE_BATCH_SIZE="5"');
  });

  it("enabled=false: writes ENABLED=false, deletes interval+batch", async () => {
    writeFileSync(
      envFile,
      'AGENT_WAKE_ENABLED="true"\nAGENT_WAKE_INTERVAL_MS="2000"\nAGENT_WAKE_BATCH_SIZE="10"\n',
    );
    const result = await writeWake({ enabled: false }, { envFile });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.fieldsWritten).toEqual(["AGENT_WAKE_ENABLED"]);
    expect(result.data.fieldsDeleted).toEqual([
      "AGENT_WAKE_INTERVAL_MS",
      "AGENT_WAKE_BATCH_SIZE",
    ]);
    const after = readFileSync(envFile, "utf8");
    expect(after).toContain('AGENT_WAKE_ENABLED="false"');
    expect(after).not.toContain("AGENT_WAKE_INTERVAL_MS");
    expect(after).not.toContain("AGENT_WAKE_BATCH_SIZE");
  });

  it("re-writes enabled=true after disabled state: replaces all 3 keys", async () => {
    writeFileSync(envFile, 'AGENT_WAKE_ENABLED="false"\n');
    const result = await writeWake(
      { enabled: true, intervalMs: 250, batchSize: 1 },
      { envFile },
    );
    expect(result.ok).toBe(true);
    const after = readFileSync(envFile, "utf8");
    expect(after).toContain('AGENT_WAKE_ENABLED="true"');
    expect(after).toContain('AGENT_WAKE_INTERVAL_MS="250"');
    expect(after).toContain('AGENT_WAKE_BATCH_SIZE="1"');
  });

  it("idempotent: calling twice with same input produces same file", async () => {
    await writeWake(
      { enabled: true, intervalMs: 1000, batchSize: 7 },
      { envFile },
    );
    const first = readFileSync(envFile, "utf8");
    await writeWake(
      { enabled: true, intervalMs: 1000, batchSize: 7 },
      { envFile },
    );
    const second = readFileSync(envFile, "utf8");
    expect(second).toBe(first);
  });
});
