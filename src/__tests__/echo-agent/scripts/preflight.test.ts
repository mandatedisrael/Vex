/**
 * Tests for src/echo-agent/scripts/_preflight.ts.
 *
 * Coverage focus (R2 Fix 1):
 *   - assertExplicitDbUrl exits with code 2 + actionable error when
 *     ECHO_AGENT_DB_URL is unset / empty / whitespace-only
 *   - assertExplicitDbUrl is a no-op when set
 *   - assertSchemaUpToDate exits with code 2 + wipe instruction when
 *     knowledge_entries.content_hash column is missing (stale schema)
 *   - assertSchemaUpToDate is a no-op when the column exists
 *   - assertSchemaUpToDate handles a null query result (defensive)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockQueryOne = vi.fn();

vi.mock("@echo-agent/db/client.js", () => ({
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: vi.fn(),
  execute: vi.fn(),
  closePool: vi.fn(),
  getPool: vi.fn(),
}));

const { assertExplicitDbUrl, assertSchemaUpToDate } = await import(
  "@echo-agent/scripts/_preflight.js"
);

describe("assertExplicitDbUrl", () => {
  const originalEnv = process.env.ECHO_AGENT_DB_URL;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ECHO_AGENT_DB_URL;
    } else {
      process.env.ECHO_AGENT_DB_URL = originalEnv;
    }
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("exits with code 2 when ECHO_AGENT_DB_URL is unset", () => {
    delete process.env.ECHO_AGENT_DB_URL;
    expect(() => assertExplicitDbUrl("test-cmd")).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrCall = stderrSpy.mock.calls[0]?.[0] as string;
    expect(stderrCall).toContain("test-cmd");
    expect(stderrCall).toContain("ECHO_AGENT_DB_URL is required");
    expect(stderrCall).toContain("echo_agent_test"); // mentions the dev fallback by name
  });

  it("exits with code 2 when ECHO_AGENT_DB_URL is empty string", () => {
    process.env.ECHO_AGENT_DB_URL = "";
    expect(() => assertExplicitDbUrl("test-cmd")).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits with code 2 when ECHO_AGENT_DB_URL is whitespace-only", () => {
    process.env.ECHO_AGENT_DB_URL = "   ";
    expect(() => assertExplicitDbUrl("test-cmd")).toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("is a no-op when ECHO_AGENT_DB_URL is set", () => {
    process.env.ECHO_AGENT_DB_URL = "postgresql://x:y@localhost:5777/echo_agent";
    expect(() => assertExplicitDbUrl("test-cmd")).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("error message names the command for context", () => {
    delete process.env.ECHO_AGENT_DB_URL;
    expect(() => assertExplicitDbUrl("knowledge-export")).toThrow("__exit__");
    const stderrCall = stderrSpy.mock.calls[0]?.[0] as string;
    expect(stderrCall.startsWith("knowledge-export:")).toBe(true);
  });
});

describe("assertSchemaUpToDate", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("is a no-op when content_hash column exists", async () => {
    mockQueryOne.mockResolvedValueOnce({ exists: true });
    await expect(assertSchemaUpToDate()).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("exits with code 2 + wipe instruction when content_hash column is missing", async () => {
    mockQueryOne.mockResolvedValueOnce({ exists: false });
    await expect(assertSchemaUpToDate()).rejects.toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const stderrCall = stderrSpy.mock.calls[0]?.[0] as string;
    expect(stderrCall).toContain("knowledge_entries.content_hash column missing");
    expect(stderrCall).toContain("docker compose");
    expect(stderrCall).toContain("down -v");
  });

  it("exits with code 2 when query returns null (defensive)", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(assertSchemaUpToDate()).rejects.toThrow("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("queries information_schema for the column", async () => {
    mockQueryOne.mockResolvedValueOnce({ exists: true });
    await assertSchemaUpToDate();
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const sql = mockQueryOne.mock.calls[0]?.[0] as string;
    expect(sql).toContain("information_schema.columns");
    expect(sql).toContain("knowledge_entries");
    expect(sql).toContain("content_hash");
  });
});
