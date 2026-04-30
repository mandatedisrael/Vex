/**
 * `vex_namespace_tools` handler — deep-dive into a single protocol namespace.
 *
 * Renders the per-namespace tool catalog (description, mutation flag, params,
 * examples) sourced from the same projection that backs MCP resource
 * `docs://protocols/{namespace}`. With no `namespace`, returns a table of
 * active namespaces with tool counts (mirror of `docs://protocols`).
 *
 * Deprecated namespaces refuse with a clear hint and a pointer at the
 * env override + the historical context file.
 */

import type { ToolResult } from "../types.js";
import {
  buildProtocolList,
  buildProtocolNamespace,
} from "../../../mcp/docs/registry-projection.js";
import {
  isKnownProtocolNamespace,
  isAdvertisedProtocolNamespace,
} from "../protocols/catalog.js";
import {
  isDeprecatedNamespace,
  NAMESPACE_LIFECYCLE,
} from "../protocols/lifecycle.js";

export async function handleVexNamespaceTools(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const namespace = typeof args.namespace === "string" ? args.namespace.trim() : "";

  if (namespace.length === 0) {
    return { success: true, output: renderNamespaceTable() };
  }

  if (!isKnownProtocolNamespace(namespace)) {
    return {
      success: false,
      output:
        `Unknown namespace "${namespace}". Active namespaces: ${listActiveNamespaceIds().join(", ")}.`,
    };
  }

  if (isDeprecatedNamespace(namespace)) {
    return {
      success: false,
      output:
        `Namespace "${namespace}" is deprecated and not maintained for dense discovery. ` +
        `Set \`VEX_ALLOW_DEPRECATED_PROTOCOLS=1\` to enable execution; embeddings are not refreshed. ` +
        `See \`src/vex-agent/tools/protocols/embeddings/_DEPRECATED.md\` for rationale.`,
    };
  }

  if (!isAdvertisedProtocolNamespace(namespace)) {
    return {
      success: false,
      output:
        `Namespace "${namespace}" is reserved (no executable manifests). ` +
        `Active namespaces: ${listActiveNamespaceIds().join(", ")}.`,
    };
  }

  const detail = buildProtocolNamespace(namespace);
  if (!detail) {
    // Should not happen — `isAdvertisedProtocolNamespace` is the gate above.
    return {
      success: false,
      output: `Namespace "${namespace}" is not exposed by the projection layer.`,
    };
  }

  return { success: true, output: renderNamespaceDetail(detail) };
}

function listActiveNamespaceIds(): string[] {
  return buildProtocolList()
    .map((n) => n.namespace)
    .filter((id) => NAMESPACE_LIFECYCLE[id] === "active");
}

function renderNamespaceTable(): string {
  const list = buildProtocolList();
  const lines: string[] = [
    "# Vex protocol namespaces",
    "",
    "Active namespaces, machine-equivalent to MCP resource `docs://protocols`.",
    "",
    "| Namespace | Active tools | Description |",
    "|---|---|---|",
  ];
  for (const ns of list) {
    const lifecycle = NAMESPACE_LIFECYCLE[ns.namespace] ?? "active";
    const tag = lifecycle === "active" ? "" : ` _(${lifecycle})_`;
    const envHint = ns.gatedByEnv.length > 0 && ns.activeToolCount === 0
      ? ` _(requires ${ns.gatedByEnv.join(", ")})_`
      : "";
    lines.push(`| \`${ns.namespace}\`${tag} | ${ns.activeToolCount} | ${ns.description}${envHint} |`);
  }
  lines.push("");
  lines.push(
    "Drill into one with `vex_namespace_tools(namespace=\"<name>\")`. For ranking, prefer `discover_tools(query, namespace=\"<name>\")`.",
  );
  return lines.join("\n");
}

interface NamespaceDetailDoc {
  namespace: string;
  description: string;
  whenToUse: string;
  exampleQueries: readonly string[];
  gatedByEnv: string[];
  tools: ReadonlyArray<{ toolId: string; description: string; mutating: boolean; lifecycle: string }>;
}

function renderNamespaceDetail(detail: NamespaceDetailDoc): string {
  const lines: string[] = [
    `# Namespace: \`${detail.namespace}\``,
    "",
    detail.description,
    "",
    `**When to use:** ${detail.whenToUse}`,
  ];
  if (detail.gatedByEnv.length > 0) {
    lines.push("");
    lines.push(`_Some tools require env: ${detail.gatedByEnv.join(", ")}_`);
  }
  if (detail.exampleQueries.length > 0) {
    lines.push("");
    lines.push(`**Example queries**: ${detail.exampleQueries.map((q) => `\`${q}\``).join(", ")}`);
  }
  lines.push("");
  lines.push(`## Tools (${detail.tools.length})`);
  lines.push("");
  for (const tool of detail.tools) {
    lines.push(`### \`${tool.toolId}\`${tool.mutating ? " — *mutating*" : ""}`);
    lines.push("");
    lines.push(tool.description);
    lines.push("");
  }
  lines.push(
    `Invoke any of these via \`execute_tool(toolId=\"<id>\", params={...})\`. For ranking call \`discover_tools(query, namespace=\"${detail.namespace}\")\`. The same data is at MCP resource \`docs://protocols/${detail.namespace}\`.`,
  );
  return lines.join("\n");
}
