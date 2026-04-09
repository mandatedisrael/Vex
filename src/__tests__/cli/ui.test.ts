import { afterEach, describe, expect, it, vi } from "vitest";

const writeStderr = vi.fn();

vi.mock("../../utils/output.js", () => ({
  isHeadless: () => false,
  writeStderr,
}));

const { renderConnectorDetails } = await import("../../cli/echo/ui.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("echo connector UI rendering", () => {
  it("prints the quickstart prompt after the connector steps", () => {
    renderConnectorDetails(
      {
        id: "claude",
        title: "Claude Code",
        description: "Ready Claude connector.",
        clientConfigPath: "Managed by Claude Code.",
        docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
        commandPreview: "claude mcp add-json --scope local echoclaw ...",
        nextSteps: ["Run the generated command."],
        quickstartPrompt: "Use the connected EchoClaw MCP in read-only mode first.\nRead docs://overview.",
        artifacts: [
          {
            fileName: "claude.server.json",
            content: "{}",
            description: "Server definition.",
          },
          {
            fileName: "quickstart.prompt.md",
            content: "Use the connected EchoClaw MCP in read-only mode first.\n",
            description: "Docs-first starter prompt to paste into your AI agent after connecting EchoClaw.",
          },
        ],
      },
      "/tmp/connectors",
    );

    expect(writeStderr).toHaveBeenCalledWith("Quickstart prompt");
    expect(writeStderr).toHaveBeenCalledWith("Use the connected EchoClaw MCP in read-only mode first.");
    expect(writeStderr).toHaveBeenCalledWith("Read docs://overview.");
  });
});
