import type { ConnectorArtifact, ConnectorBundle } from "./connectors.js";
import { formatShellCommand, getStdioInvocation } from "./connector-stdio.js";

export function buildConnectorReadme(
  bundles: readonly ConnectorBundle[],
  quickstartArtifact: ConnectorArtifact,
): string {
  const lines: string[] = [
    "# EchoClaw MCP connectors",
    "",
    `Generated for local MCP setup. Server command: \`${formatShellCommand(getStdioInvocation().command, getStdioInvocation().args)}\`.`,
    "",
  ];

  for (const bundle of bundles) {
    lines.push(`## ${bundle.title}`);
    lines.push("");
    lines.push(bundle.description);
    lines.push("");
    lines.push(`Client config target: ${bundle.clientConfigPath}`);
    if (bundle.docsUrl) {
      lines.push(`Docs: ${bundle.docsUrl}`);
    }
    if (bundle.commandPreview) {
      lines.push("");
      lines.push("Command:");
      lines.push("```bash");
      lines.push(bundle.commandPreview);
      lines.push("```");
    }
    lines.push("");
    lines.push("Artifacts:");
    for (const artifact of bundle.artifacts) {
      lines.push(`- ${artifact.fileName} — ${artifact.description}`);
    }
    lines.push("");
  }

  lines.push("## Quickstart");
  lines.push("");
  lines.push(`Prompt file: ${quickstartArtifact.fileName}`);
  lines.push("");
  lines.push("Paste this into your AI agent after the MCP is connected:");
  lines.push("```text");
  lines.push(bundles[0]?.quickstartPrompt ?? quickstartArtifact.content.trim());
  lines.push("```");
  lines.push("");

  return lines.join("\n") + "\n";
}
