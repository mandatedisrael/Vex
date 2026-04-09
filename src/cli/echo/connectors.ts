import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONNECTORS_DIR } from "../../config/paths.js";
import { getHttpTokenPath } from "../../mcp/auth/token.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { buildConnectorReadme } from "./connector-readme.js";
import {
  buildClaudeServerConfig,
  buildOpenClawServerConfig,
  buildRootMcpConfig,
  formatShellCommand,
  getStdioInvocation,
  shellQuote,
} from "./connector-stdio.js";
import {
  buildQuickstartPrompt,
  QUICKSTART_PROMPT_DESCRIPTION,
  QUICKSTART_PROMPT_FILE_NAME,
} from "./quickstart.js";

export type ConnectorTarget = "cursor" | "claude" | "codex" | "openclaw" | "default";

export interface ConnectorArtifact {
  fileName: string;
  content: string;
  description: string;
}

export interface ConnectorBundle {
  id: ConnectorTarget;
  title: string;
  description: string;
  docsUrl?: string;
  clientConfigPath: string;
  commandPreview?: string;
  nextSteps: string[];
  quickstartPrompt: string;
  artifacts: ConnectorArtifact[];
}

const MCP_SERVER_NAME = "echoclaw";

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function buildConnectorBundles(baseDir: string = CONNECTORS_DIR): ConnectorBundle[] {
  const cursorPath = join(baseDir, "cursor.mcp.json");
  const claudeServerPath = join(baseDir, "claude.server.json");
  const claudeCommandPath = join(baseDir, "claude.add-json.txt");
  const codexCommandPath = join(baseDir, "codex.add.txt");
  const openClawServerPath = join(baseDir, "openclaw.server.json");
  const openClawCommandPath = join(baseDir, "openclaw.set.txt");
  const defaultPath = join(baseDir, "default.mcp.json");
  const defaultHttpPath = join(baseDir, "default-http.txt");
  const tokenPath = getHttpTokenPath();
  const stdioInvocation = getStdioInvocation();
  const quickstartPrompt = buildQuickstartPrompt();
  const quickstartArtifact = {
    fileName: QUICKSTART_PROMPT_FILE_NAME,
    content: quickstartPrompt + "\n",
    description: QUICKSTART_PROMPT_DESCRIPTION,
  } satisfies ConnectorArtifact;

  const cursorConfig = stableJson(buildRootMcpConfig(stdioInvocation));
  const claudeServerConfig = stableJson(buildClaudeServerConfig(stdioInvocation));
  const openClawServerConfig = stableJson(buildOpenClawServerConfig(stdioInvocation));
  const defaultConfig = stableJson(buildRootMcpConfig(stdioInvocation));

  const claudeCommand =
    `claude mcp add-json --scope local ${MCP_SERVER_NAME} "$(cat ${shellQuote(claudeServerPath)})"\n`;
  const codexCommand =
    `codex mcp add ${MCP_SERVER_NAME} -- ${formatShellCommand(stdioInvocation.command, stdioInvocation.args)}\n`;
  const openClawCommand =
    `openclaw mcp set ${MCP_SERVER_NAME} "$(cat ${shellQuote(openClawServerPath)})"\n`;
  const defaultHttpNotes =
    `HTTP endpoint: http://127.0.0.1:4203/mcp\n` +
    `Bearer token file: ${tokenPath}\n` +
    `Use this only with clients that explicitly support streamable HTTP MCP.\n`;

  return [
    {
      id: "cursor",
      title: "Cursor",
      description:
        "Ready stdio MCP config for Cursor. Merge or copy this file into .cursor/mcp.json or ~/.cursor/mcp.json.",
      docsUrl: "https://docs.cursor.com/en/context/mcp",
      clientConfigPath: ".cursor/mcp.json or ~/.cursor/mcp.json",
      nextSteps: [
        "Open Cursor MCP settings or place the generated file in your preferred Cursor MCP config path.",
        "Reload Cursor after saving the config so the new server is picked up.",
      ],
      quickstartPrompt,
      artifacts: [
        {
          fileName: "cursor.mcp.json",
          content: cursorConfig,
          description: "Project/global Cursor MCP config snippet.",
        },
        quickstartArtifact,
      ],
    },
    {
      id: "claude",
      title: "Claude Code",
      description:
        "Ready Claude Code connector for local stdio MCP. Uses the Claude CLI add-json flow with a generated server definition.",
      docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
      clientConfigPath: "Managed by Claude Code local scope via `claude mcp add-json --scope local`.",
      commandPreview: claudeCommand.trim(),
      nextSteps: [
        "Run the generated command from your shell.",
        "Use `claude mcp list` to verify EchoClaw was registered.",
      ],
      quickstartPrompt,
      artifacts: [
        {
          fileName: "claude.server.json",
          content: claudeServerConfig,
          description: "Server definition consumed by `claude mcp add-json`.",
        },
        {
          fileName: "claude.add-json.txt",
          content: claudeCommand,
          description: "Exact Claude Code command to register EchoClaw locally.",
        },
        quickstartArtifact,
      ],
    },
    {
      id: "codex",
      title: "Codex",
      description:
        "Ready Codex CLI connector verified against the local `codex mcp add` command contract for stdio MCP servers.",
      clientConfigPath: "~/.codex/config.toml (managed by `codex mcp add`).",
      commandPreview: codexCommand.trim(),
      nextSteps: [
        "Run the generated `codex mcp add` command from your shell.",
        "Use `codex mcp list` to confirm that EchoClaw is configured.",
      ],
      quickstartPrompt,
      artifacts: [
        {
          fileName: "codex.add.txt",
          content: codexCommand,
          description: "Exact Codex CLI command to register EchoClaw.",
        },
        quickstartArtifact,
      ],
    },
    {
      id: "openclaw",
      title: "OpenClaw",
      description:
        "Ready OpenClaw connector for the client-side MCP registry. This uses the `openclaw mcp set` flow, not `openclaw mcp serve`.",
      docsUrl: "https://docs.openclaw.ai/cli/mcp",
      clientConfigPath: "Managed by OpenClaw via `openclaw mcp set`.",
      commandPreview: openClawCommand.trim(),
      nextSteps: [
        "Run the generated `openclaw mcp set` command from your shell.",
        "Verify the server in your OpenClaw MCP registry before starting a session.",
      ],
      quickstartPrompt,
      artifacts: [
        {
          fileName: "openclaw.server.json",
          content: openClawServerConfig,
          description: "Server definition consumed by `openclaw mcp set`.",
        },
        {
          fileName: "openclaw.set.txt",
          content: openClawCommand,
          description: "Exact OpenClaw command to register EchoClaw.",
        },
        quickstartArtifact,
      ],
    },
    {
      id: "default",
      title: "Default MCP Client",
      description:
        "Generic stdio MCP config for clients that accept the common `mcpServers` JSON shape. Includes advanced HTTP notes for clients that need streamable HTTP.",
      clientConfigPath: "Client-specific MCP config file or settings screen.",
      nextSteps: [
        "Use the generated stdio JSON as the default connector for generic MCP clients.",
        "Use the HTTP notes only if your client explicitly supports streamable HTTP MCP.",
      ],
      quickstartPrompt,
      artifacts: [
        {
          fileName: "default.mcp.json",
          content: defaultConfig,
          description: "Generic stdio MCP config using the common `mcpServers` shape.",
        },
        {
          fileName: "default-http.txt",
          content: defaultHttpNotes,
          description: "Advanced HTTP endpoint and bearer token details.",
        },
        quickstartArtifact,
      ],
    },
  ];
}

function writeTextFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${path}.tmp.${Date.now()}`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, path);

  try {
    chmodSync(path, 0o644);
  } catch {
    // Non-fatal on platforms without POSIX permissions.
  }
}

export interface GeneratedConnectorOutput {
  directory: string;
  bundles: ConnectorBundle[];
  readmePath: string;
}

export function writeConnectorArtifacts(baseDir: string = CONNECTORS_DIR): GeneratedConnectorOutput {
  const bundles = buildConnectorBundles(baseDir);

  try {
    mkdirSync(baseDir, { recursive: true });

    for (const bundle of bundles) {
      for (const artifact of bundle.artifacts) {
        writeTextFileAtomic(join(baseDir, artifact.fileName), artifact.content);
      }
    }

    const readmePath = join(baseDir, "README.md");
    const quickstartArtifact = bundles[0]?.artifacts.find(
      (artifact) => artifact.fileName === QUICKSTART_PROMPT_FILE_NAME,
    );
    if (!quickstartArtifact) {
      throw new Error("Quickstart prompt artifact is missing from the generated connector bundles.");
    }
    writeTextFileAtomic(readmePath, buildConnectorReadme(bundles, quickstartArtifact));

    return { directory: baseDir, bundles, readmePath };
  } catch (err) {
    throw new EchoError(
      ErrorCodes.CONNECTOR_WRITE_FAILED,
      err instanceof Error ? err.message : String(err),
      "Check permissions for the EchoClaw config directory.",
    );
  }
}

export function readGeneratedArtifact(path: string): string {
  return readFileSync(path, "utf-8");
}
