/**
 * Tests for provider-writer (M10 Step 6).
 *
 * Real fs against tmp dir; verifies:
 *  - 3 keys (OPENROUTER_API_KEY + AGENT_MODEL + AGENT_PROVIDER) persisted
 *    in canonical order via `appendMultipleToDotenvFile`.
 *  - Stale unsupported `AGENT_PROVIDER` line gets REPLACED to openrouter
 *    (codex turn 2 RED #2 — engine precedence-aware overwrite).
 *  - Duplicate AGENT_PROVIDER lines from manual edits are all stripped
 *    before canonical append.
 *  - File mode 0o600 maintained.
 *  - Unrelated comments + keys preserved.
 *  - Quote-escape format matches `appendToDotenvFile` round-trip.
 *  - VexError on fs failure carries `details.verified=true`.
 *  - Error `domain === "onboarding"` consistently (codex turn 4 test add).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { writeProvider } = await import("../provider-writer.js");
const { readDotenvFileValue } = await import("@vex-lib/dotenv.js");

let tmpDir = "";
let envFile = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-provider-"));
  envFile = path.join(tmpDir, ".env");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("writeProvider", () => {
  it("persists 3 keys in canonical order on empty file", async () => {
    const r = await writeProvider(
      {
        provider: "openrouter",
        apiKey: "sk-or-test-123",
        model: "anthropic/claude-sonnet-4.5",
      },
      { envFile },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.fieldsWritten).toEqual([
        "OPENROUTER_API_KEY",
        "AGENT_MODEL",
        "AGENT_PROVIDER",
      ]);
    }
    expect(readDotenvFileValue("OPENROUTER_API_KEY", envFile)).toBe(
      "sk-or-test-123",
    );
    expect(readDotenvFileValue("AGENT_MODEL", envFile)).toBe(
      "anthropic/claude-sonnet-4.5",
    );
    expect(readDotenvFileValue("AGENT_PROVIDER", envFile)).toBe("openrouter");
  });

  it("REPLACES stale unsupported AGENT_PROVIDER with openrouter (codex turn 2 RED #2)", async () => {
    writeFileSync(
      envFile,
      [
        'JUPITER_API_KEY="jup-key"',
        'AGENT_PROVIDER="unsupported-provider"',
        'OTHER_KEY="keep-me"',
      ].join("\n") + "\n",
    );
    const r = await writeProvider(
      {
        provider: "openrouter",
        apiKey: "sk-or-test",
        model: "anthropic/claude-sonnet-4.5",
      },
      { envFile },
    );
    expect(r.ok).toBe(true);
    expect(readDotenvFileValue("AGENT_PROVIDER", envFile)).toBe("openrouter");
    expect(readDotenvFileValue("JUPITER_API_KEY", envFile)).toBe("jup-key");
    expect(readDotenvFileValue("OTHER_KEY", envFile)).toBe("keep-me");
    const content = readFileSync(envFile, "utf-8");
    expect(content).not.toContain('AGENT_PROVIDER="unsupported-provider"');
  });

  it("strips duplicate AGENT_PROVIDER lines (manual edit edge case)", async () => {
    writeFileSync(
      envFile,
      [
        'AGENT_PROVIDER="unsupported-provider"',
        'AGENT_PROVIDER="openrouter"', // duplicate
        'AGENT_MODEL="stale-model"',
      ].join("\n") + "\n",
    );
    const r = await writeProvider(
      {
        provider: "openrouter",
        apiKey: "sk-or-test",
        model: "new-model",
      },
      { envFile },
    );
    expect(r.ok).toBe(true);
    const content = readFileSync(envFile, "utf-8");
    // Exactly ONE AGENT_PROVIDER line in the final file.
    expect(content.match(/^AGENT_PROVIDER=/gm)?.length).toBe(1);
    expect(content.match(/^AGENT_MODEL=/gm)?.length).toBe(1);
    expect(readDotenvFileValue("AGENT_MODEL", envFile)).toBe("new-model");
  });

  it("writes mode 0o600 on the .env file", async () => {
    await writeProvider(
      {
        provider: "openrouter",
        apiKey: "sk-or-test",
        model: "x",
      },
      { envFile },
    );
    const mode = statSync(envFile).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("preserves unrelated content + comments", async () => {
    writeFileSync(
      envFile,
      [
        "# Vex config",
        "",
        'JUPITER_API_KEY="jup"',
        'VEX_KEYSTORE_PASSWORD="pwd"',
      ].join("\n") + "\n",
    );
    await writeProvider(
      {
        provider: "openrouter",
        apiKey: "sk-or-test",
        model: "x",
      },
      { envFile },
    );
    const content = readFileSync(envFile, "utf-8");
    expect(content).toContain("# Vex config");
    expect(content).toContain('JUPITER_API_KEY="jup"');
    expect(content).toContain('VEX_KEYSTORE_PASSWORD="pwd"');
  });

  it("round-trips quoted values via readDotenvFileValue", async () => {
    const apiKey = 'sk-with-"quotes"-and-\\backslash';
    await writeProvider(
      { provider: "openrouter", apiKey, model: "x" },
      { envFile },
    );
    expect(readDotenvFileValue("OPENROUTER_API_KEY", envFile)).toBe(apiKey);
  });

  it("returns onboarding.env_persist_failed (domain=onboarding) on fs error", async () => {
    // Use a path inside a file (not a dir) — fs.writeFileSync will fail.
    const blockingFile = path.join(tmpDir, "blocker");
    writeFileSync(blockingFile, "x");
    const r = await writeProvider(
      { provider: "openrouter", apiKey: "sk-or-test", model: "x" },
      { envFile: path.join(blockingFile, ".env") },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("onboarding.env_persist_failed");
      expect(r.error.domain).toBe("onboarding");
      expect((r.error.details as { verified?: boolean }).verified).toBe(true);
    }
  });
});
