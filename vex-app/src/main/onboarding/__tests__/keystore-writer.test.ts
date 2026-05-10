/**
 * Tests for setKeystorePassword — the M7 main-side writer that
 * persists VEX_KEYSTORE_PASSWORD to the shared CONFIG_DIR/.env via
 * appendToDotenvFile. Uses real fs against a tmp dir; the writer
 * accepts an `envFile` override so we don't need to mock the engine
 * util or the path module.
 */

import { promises as fs } from "node:fs";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger/index.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { setKeystorePassword } = await import("../keystore-writer.js");
const { readDotenvFileValue } = await import("@vex-lib/dotenv.js");

let tmpDir = "";
let envFile = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-keystore-"));
  envFile = path.join(tmpDir, ".env");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("setKeystorePassword", () => {
  it("creates the .env file and persists the password (kind:'set')", async () => {
    expect(existsSync(envFile)).toBe(false);
    const result = await setKeystorePassword("correct horse 8c", { envFile });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.kind).toBe("set");
    expect(existsSync(envFile)).toBe(true);
    expect(readDotenvFileValue("VEX_KEYSTORE_PASSWORD", envFile)).toBe(
      "correct horse 8c"
    );
  });

  it("returns kind:'unchanged' when the same password is re-submitted", async () => {
    await setKeystorePassword("identical-pwd", { envFile });
    const second = await setKeystorePassword("identical-pwd", { envFile });

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.kind).toBe("unchanged");
    expect(readDotenvFileValue("VEX_KEYSTORE_PASSWORD", envFile)).toBe(
      "identical-pwd"
    );
  });

  it("rotates the value when a different password is submitted", async () => {
    await setKeystorePassword("old-password-123", { envFile });
    const second = await setKeystorePassword("new-password-456", { envFile });

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.kind).toBe("set");
    expect(readDotenvFileValue("VEX_KEYSTORE_PASSWORD", envFile)).toBe(
      "new-password-456"
    );
  });

  it("preserves other env keys already in the file", async () => {
    await fs.writeFile(envFile, 'JUPITER_API_KEY="existing-key"\n', "utf8");
    const result = await setKeystorePassword("master-password", { envFile });

    expect(result.ok).toBe(true);
    expect(readDotenvFileValue("JUPITER_API_KEY", envFile)).toBe("existing-key");
    expect(readDotenvFileValue("VEX_KEYSTORE_PASSWORD", envFile)).toBe(
      "master-password"
    );
  });

  it("writes the file with mode 0o600 (POSIX)", async () => {
    if (process.platform === "win32") return; // POSIX modes don't apply
    await setKeystorePassword("posix-password", { envFile });
    const stat = statSync(envFile);
    // mask off the file-type bits, compare the permission bits only
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("escapes a value containing quotes so the roundtrip survives", async () => {
    const trickyPassword = 'has "quotes" and \\ slashes';
    const result = await setKeystorePassword(trickyPassword, { envFile });

    expect(result.ok).toBe(true);
    expect(readDotenvFileValue("VEX_KEYSTORE_PASSWORD", envFile)).toBe(
      trickyPassword
    );
    // Sanity: the raw file should contain escaped quotes, not the bare
    // string, so a manual `cat .env` doesn't surface a malformed line.
    const raw = readFileSync(envFile, "utf8");
    expect(raw).toContain("\\\"");
  });
});
