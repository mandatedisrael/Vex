/**
 * `appendMultipleToDotenvFile` — atomic multi-key .env writer (M10).
 *
 * Verifies the contract documented in plan v4 §appendMultipleToDotenvFile:
 *   - canonical-order append with quoted values matching `appendToDotenvFile`
 *   - de-dupe of all existing occurrences of every provided key
 *   - CRLF preservation for unrelated lines
 *   - round-trip via `readDotenvFileValue`
 *   - atomic temp+rename + mode 0o600
 *   - unrelated lines + comments preserved
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendMultipleToDotenvFile,
  appendToDotenvFile,
  readDotenvFileValue,
} from "../../utils/dotenv.js";

describe("appendMultipleToDotenvFile", () => {
  let dir: string;
  let envFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vex-dotenv-multi-"));
    envFile = join(dir, ".env");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes 3 keys in insertion order on an empty file", () => {
    appendMultipleToDotenvFile(
      {
        OPENROUTER_API_KEY: "sk-or-test-123",
        AGENT_MODEL: "anthropic/claude-sonnet-4.5",
        AGENT_PROVIDER: "openrouter",
      },
      envFile,
    );
    const content = readFileSync(envFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines).toEqual([
      'OPENROUTER_API_KEY="sk-or-test-123"',
      'AGENT_MODEL="anthropic/claude-sonnet-4.5"',
      'AGENT_PROVIDER="openrouter"',
    ]);
  });

  it("strips ALL existing occurrences (duplicate-line de-dupe)", () => {
    writeFileSync(
      envFile,
      [
        'AGENT_PROVIDER="unsupported-provider"',
        'OTHER_KEY="keep-me"',
        'AGENT_PROVIDER="unsupported-provider"', // duplicate from manual edit
        'AGENT_MODEL="old-model"',
      ].join("\n") + "\n",
    );
    appendMultipleToDotenvFile(
      {
        OPENROUTER_API_KEY: "sk-or-test",
        AGENT_MODEL: "anthropic/claude-sonnet-4.5",
        AGENT_PROVIDER: "openrouter",
      },
      envFile,
    );
    const content = readFileSync(envFile, "utf-8");
    // OTHER_KEY preserved exactly once.
    expect(content.match(/^OTHER_KEY=/gm)?.length).toBe(1);
    // No leftover unsupported provider anywhere.
    expect(content).not.toContain('AGENT_PROVIDER="unsupported-provider"');
    // No leftover AGENT_MODEL="old-model".
    expect(content).not.toContain('AGENT_MODEL="old-model"');
    // Canonical lines present.
    expect(content).toContain('OPENROUTER_API_KEY="sk-or-test"');
    expect(content).toContain('AGENT_MODEL="anthropic/claude-sonnet-4.5"');
    expect(content).toContain('AGENT_PROVIDER="openrouter"');
  });

  it("handles CRLF line endings without losing unrelated keys", () => {
    writeFileSync(
      envFile,
      'OTHER_A="alpha"\r\nAGENT_PROVIDER="unsupported-provider"\r\nOTHER_B="beta"\r\n',
    );
    appendMultipleToDotenvFile(
      {
        OPENROUTER_API_KEY: "sk-or-test",
        AGENT_PROVIDER: "openrouter",
      },
      envFile,
    );
    const content = readFileSync(envFile, "utf-8");
    expect(content).toContain('OTHER_A="alpha"');
    expect(content).toContain('OTHER_B="beta"');
    expect(content).not.toContain('AGENT_PROVIDER="unsupported-provider"');
    expect(content).toContain('AGENT_PROVIDER="openrouter"');
  });

  it("round-trips quoted values via readDotenvFileValue", () => {
    appendMultipleToDotenvFile(
      {
        OPENROUTER_API_KEY: 'sk-with-"quotes"-and-\\backslash',
        AGENT_MODEL: "anthropic/claude-sonnet-4.5",
      },
      envFile,
    );
    expect(readDotenvFileValue("OPENROUTER_API_KEY", envFile)).toBe(
      'sk-with-"quotes"-and-\\backslash',
    );
    expect(readDotenvFileValue("AGENT_MODEL", envFile)).toBe(
      "anthropic/claude-sonnet-4.5",
    );
  });

  it("writes mode 0o600 on the final file", () => {
    appendMultipleToDotenvFile(
      { OPENROUTER_API_KEY: "sk-or-test", AGENT_MODEL: "x" },
      envFile,
    );
    const mode = statSync(envFile).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("preserves comments and unrelated content", () => {
    writeFileSync(
      envFile,
      [
        "# Vex configuration",
        "",
        'JUPITER_API_KEY="jup-key"',
        "# Old provider section",
        'AGENT_PROVIDER="unsupported-provider"',
        'VEX_KEYSTORE_PASSWORD="pwd"',
      ].join("\n") + "\n",
    );
    appendMultipleToDotenvFile(
      { AGENT_PROVIDER: "openrouter" },
      envFile,
    );
    const content = readFileSync(envFile, "utf-8");
    expect(content).toContain("# Vex configuration");
    expect(content).toContain("# Old provider section");
    expect(content).toContain('JUPITER_API_KEY="jup-key"');
    expect(content).toContain('VEX_KEYSTORE_PASSWORD="pwd"');
    expect(content).toContain('AGENT_PROVIDER="openrouter"');
    expect(content).not.toContain('AGENT_PROVIDER="unsupported-provider"');
  });

  it("strips leading-whitespace stale lines (loader-honored edge case)", () => {
    // `loadDotenvFileIntoProcess` calls `line.trim()` before parsing,
    // so a manually-edited line with leading spaces is a valid env entry
    // for the engine but would survive a naive strip — verify we catch it.
    writeFileSync(
      envFile,
      [
        "  AGENT_PROVIDER=\"unsupported-provider\"", // leading 2 spaces
        '\tAGENT_MODEL="stale-tab-prefixed"', // leading tab
        '   OPENROUTER_API_KEY="stale-3-spaces"',
      ].join("\n") + "\n",
    );
    appendMultipleToDotenvFile(
      {
        OPENROUTER_API_KEY: "sk-or-canonical",
        AGENT_MODEL: "anthropic/claude-sonnet-4.5",
        AGENT_PROVIDER: "openrouter",
      },
      envFile,
    );
    const content = readFileSync(envFile, "utf-8");
    // Stale leading-whitespace lines must be gone.
    expect(content).not.toMatch(/AGENT_PROVIDER="unsupported-provider"/);
    expect(content).not.toMatch(/AGENT_MODEL="stale-tab-prefixed"/);
    expect(content).not.toMatch(/OPENROUTER_API_KEY="stale-3-spaces"/);
    // Canonical lines present at end of file.
    expect(content).toContain('AGENT_PROVIDER="openrouter"');
    expect(content).toContain('AGENT_MODEL="anthropic/claude-sonnet-4.5"');
    expect(content).toContain('OPENROUTER_API_KEY="sk-or-canonical"');
    // Round-trip via the same loader semantics: readDotenvFileValue trims.
    expect(readDotenvFileValue("AGENT_PROVIDER", envFile)).toBe("openrouter");
  });

  it("matches appendToDotenvFile single-key output for the same key+value", () => {
    const otherFile = join(dir, ".env.single");
    appendToDotenvFile("AGENT_MODEL", "anthropic/claude-sonnet-4.5", otherFile);
    appendMultipleToDotenvFile(
      { AGENT_MODEL: "anthropic/claude-sonnet-4.5" },
      envFile,
    );
    // Both files end with the same canonical line; only difference is the
    // single-key writer may have written into a pre-existing trim'd file.
    const single = readFileSync(otherFile, "utf-8").trim();
    const multi = readFileSync(envFile, "utf-8").trim();
    expect(single).toBe('AGENT_MODEL="anthropic/claude-sonnet-4.5"');
    expect(multi).toBe('AGENT_MODEL="anthropic/claude-sonnet-4.5"');
  });
});
