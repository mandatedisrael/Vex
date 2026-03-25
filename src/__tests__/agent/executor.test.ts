import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockToolCall } from "./_fixtures.js";

// Mock child_process
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { executeTool, redactArgs, shellSplit, isMutatingCommand } = await import(
  "../../agent/executor.js"
);

beforeEach(() => { vi.clearAllMocks(); });

// ── redactArgs ──────────────────────────────────────────────────────

describe("redactArgs", () => {
  it("passes non-sensitive args through", () => {
    expect(redactArgs(["wallet", "balance", "--json"])).toBe("wallet balance --json");
  });

  it("redacts --private-key value", () => {
    expect(redactArgs(["send", "--private-key", "0xabc123"])).toBe("send --private-key [REDACTED]");
  });

  it("redacts --token value", () => {
    expect(redactArgs(["--token", "secret123"])).toBe("--token [REDACTED]");
  });

  it("redacts --api-key value", () => {
    expect(redactArgs(["--api-key", "sk-abc"])).toBe("--api-key [REDACTED]");
  });

  it("redacts --mnemonic value", () => {
    expect(redactArgs(["--mnemonic", "word1 word2"])).toBe("--mnemonic [REDACTED]");
  });

  it("handles --secret at end without value", () => {
    expect(redactArgs(["--secret"])).toBe("--secret");
  });

  it("redacts multiple sensitive flags", () => {
    const result = redactArgs(["--password", "pass123", "--seed", "s33d"]);
    expect(result).toBe("--password [REDACTED] --seed [REDACTED]");
  });
});

// ── shellSplit ──────────────────────────────────────────────────────

describe("shellSplit", () => {
  it("splits simple space-separated tokens", () => {
    expect(shellSplit("SOL USDC --amount 1")).toEqual(["SOL", "USDC", "--amount", "1"]);
  });

  it("respects double quotes", () => {
    expect(shellSplit('--prompt "a futuristic city" --json')).toEqual([
      "--prompt", "a futuristic city", "--json",
    ]);
  });

  it("respects single quotes", () => {
    expect(shellSplit("--name 'my token'")).toEqual(["--name", "my token"]);
  });

  it("handles empty input", () => {
    expect(shellSplit("")).toEqual([]);
  });

  it("handles multiple spaces", () => {
    expect(shellSplit("  a   b  ")).toEqual(["a", "b"]);
  });

  it("handles tabs", () => {
    expect(shellSplit("a\tb")).toEqual(["a", "b"]);
  });
});

// ── isMutatingCommand ───────────────────────────────────────────────

describe("isMutatingCommand", () => {
  it("returns false for non-mutating commands (no CLI tools currently registered)", () => {
    // With empty CLI_TOOLS, nothing should be mutating except if internal
    expect(isMutatingCommand("wallet_balance")).toBe(false);
  });

  it("returns false for internal tools", () => {
    expect(isMutatingCommand("file_read")).toBe(false);
    expect(isMutatingCommand("web_search")).toBe(false);
  });

  it("returns false for unknown commands", () => {
    expect(isMutatingCommand("unknown_command")).toBe(false);
  });
});

// ── executeTool ─────────────────────────────────────────────────────

describe("executeTool", () => {
  it("returns success with stdout on successful execution", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, '{"balance": "1.5"}', "");
    });

    const call = mockToolCall("wallet balance");
    const result = await executeTool(call, false);

    expect(result.success).toBe(true);
    expect(result.output).toBe('{"balance": "1.5"}');
    expect(result.command).toBe("wallet balance");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns failure with stderr on error", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error("exit code 1"), "", "Some error message");
    });

    const call = mockToolCall("wallet balance");
    const result = await executeTool(call, false);

    expect(result.success).toBe(false);
    expect(result.output).toBe("Some error message");
  });

  it("returns timeout message when command is killed", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = new Error("killed") as NodeJS.ErrnoException;
      (err as any).killed = true;
      cb(err, "", "");
    });

    const result = await executeTool(mockToolCall("wallet balance"), false);
    expect(result.success).toBe(false);
    expect(result.output).toContain("timed out");
  });

  it("always appends --json flag", async () => {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      cb(null, "{}", "");
    });

    await executeTool(mockToolCall("wallet balance"), false);
    const calledArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(calledArgs).toContain("--json");
  });

  it("converts underscores to spaces in command", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, "{}", "");
    });

    await executeTool(mockToolCall("wallet_balance"), false);
    const calledArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(calledArgs[0]).toBe("wallet");
    expect(calledArgs[1]).toBe("balance");
  });

  it("appends --yes when confirmed and command supports it", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, "{}", "");
    });

    const call = mockToolCall("solana_swap_execute", {}, { confirm: true });
    await executeTool(call, true);
    const calledArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(calledArgs).toContain("--yes");
  });

  it("does NOT append --yes when command does not support it", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, "{}", "");
    });

    const call = mockToolCall("wallet_balance", {}, { confirm: true });
    await executeTool(call, true);
    const calledArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(calledArgs).not.toContain("--yes");
  });

  it("parses args string via shellSplit", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, "{}", "");
    });

    const call = mockToolCall("wallet balance", { args: '--amount 1.5 --to "0xabc"' });
    await executeTool(call, false);
    const calledArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(calledArgs).toContain("--amount");
    expect(calledArgs).toContain("1.5");
    expect(calledArgs).toContain("0xabc");
  });
});
