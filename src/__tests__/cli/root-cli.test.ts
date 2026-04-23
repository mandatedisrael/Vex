import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../errors.js";

const runEchoCli = vi.fn();
const runMcpCli = vi.fn();
const suppressDep0040Warnings = vi.fn();

vi.mock("../../cli/echo/index.js", () => ({
  runEchoCli,
}));

vi.mock("../../cli/shared/warnings.js", () => ({
  suppressDep0040Warnings,
}));

vi.mock("../../mcp/index.js", () => ({
  runMcpCli,
}));

const { buildRootHelpText, runRootCli } = await import("../../cli/index.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("root CLI router", () => {
  it("documents the echo and mcp entrypoints", () => {
    const helpText = buildRootHelpText();

    expect(helpText).toContain("echoclaw <command>");
    expect(helpText).toContain("echo");
    expect(helpText).toContain("mcp");
  });

  it("does not advertise vex as an npm CLI surface", () => {
    const helpText = buildRootHelpText();

    expect(helpText.toLowerCase()).not.toContain("vex");
  });

  it("delegates echo arguments to the echo router", async () => {
    await runRootCli(["echo", "connect"]);
    expect(suppressDep0040Warnings).toHaveBeenCalledTimes(1);
    expect(runEchoCli).toHaveBeenCalledWith(["connect"]);
  });

  it("delegates mcp arguments to the MCP runtime", async () => {
    await runRootCli(["mcp", "--transport", "stdio"]);
    expect(suppressDep0040Warnings).not.toHaveBeenCalled();
    expect(runMcpCli).toHaveBeenCalledWith(["--transport", "stdio"]);
  });

  it("rejects vex as an unknown command", async () => {
    await expect(runRootCli(["vex"])).rejects.toMatchObject({
      code: ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    });
  });

  it("rejects unknown root commands with a structured CLI error", async () => {
    await expect(runRootCli(["unknown"])).rejects.toMatchObject({
      code: ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    });
  });
});
