import {
  buildProtocolList,
  buildToolGroups,
} from "./registry-projection.js";

export interface OnboardingReadStep {
  uri: string;
  purpose: string;
}

export interface McpOnboardingGuide {
  internalToolCount: number;
  metaToolCount: number;
  protocolNamespaceCount: number;
  directToolPatterns: string[];
  readOrder: OnboardingReadStep[];
  memoryPolicy: {
    document: string;
    knowledge: string;
  };
}

const DIRECT_TOOL_GROUP_PATTERNS: Record<string, string> = {
  Knowledge: "knowledge_*",
  Documents: "document_*",
  Wallet: "wallet_*",
  Portfolio: "portfolio_*",
  Web: "web_*",
  EVM: "evm_*",
  Setup: "*_setup",
  Other: "other surfaced internal tools",
};

export function buildMcpOnboardingGuide(): McpOnboardingGuide {
  const toolGroups = buildToolGroups();
  const metaToolCount = toolGroups.find((group) => group.group === "Discovery")?.tools.length ?? 0;
  const internalGroups = toolGroups.filter((group) => group.group !== "Discovery");
  const internalToolCount = internalGroups.reduce((total, group) => total + group.tools.length, 0);
  const directToolPatterns = internalGroups
    .map((group) => DIRECT_TOOL_GROUP_PATTERNS[group.group])
    .filter((pattern): pattern is string => Boolean(pattern));

  return {
    internalToolCount,
    metaToolCount,
    protocolNamespaceCount: buildProtocolList().length,
    directToolPatterns,
    readOrder: [
      {
        uri: "docs://overview",
        purpose: "server purpose, live surface size, and runtime shape",
      },
      {
        uri: "docs://tools",
        purpose: "direct internal tools you can call by name",
      },
      {
        uri: "docs://protocols",
        purpose: "which protocol namespace matches the user's intent",
      },
      {
        uri: "docs://protocols/{namespace}",
        purpose: "the chosen namespace's tool manifest before discover_tools",
      },
      {
        uri: "runtime://env",
        purpose: "which integrations are currently gated by missing env",
      },
      {
        uri: "surface://manifest",
        purpose: "optional machine-readable snapshot when you need raw surface data",
      },
    ],
    memoryPolicy: {
      document:
        "`document_*` is a freeform scratchpad for notes and reference material that helps with the current task.",
      knowledge:
        "`knowledge_*` is durable retrievable memory; use it only for insights worth recalling later or when the user explicitly wants memory.",
    },
  };
}

export function buildOnboardingReadOrderLines(): string[] {
  return buildMcpOnboardingGuide().readOrder.map((step) => `- \`${step.uri}\` — ${step.purpose}`);
}

export function buildDirectToolRoutingLines(): string[] {
  const guide = buildMcpOnboardingGuide();
  return [
    `- Direct internal tools are already surfaced individually in \`tools/list\` and \`docs://tools\`. Use them by real name: ${guide.directToolPatterns.join(", ")}.`,
    "- Protocol tools are NOT surfaced individually. Pick a namespace from `docs://protocols`, read `docs://protocols/{namespace}`, then use `discover_tools` and `execute_tool`.",
    "- Do not scan every namespace by default. Start from the user's intent and the namespace `Use when` hints.",
  ];
}

export function buildMemoryPolicyLines(): string[] {
  const guide = buildMcpOnboardingGuide();
  return [
    `- ${guide.memoryPolicy.document}`,
    `- ${guide.memoryPolicy.knowledge}`,
  ];
}

export function buildSurfaceSummaryLine(): string {
  const guide = buildMcpOnboardingGuide();
  return (
    `The live surface currently exposes ${guide.internalToolCount} direct internal tools, ` +
    `${guide.metaToolCount} meta tools, and ${guide.protocolNamespaceCount} protocol namespaces.`
  );
}

export function buildInstructionsSurfaceSummaryLine(): string {
  const guide = buildMcpOnboardingGuide();
  return (
    `It exposes ${guide.internalToolCount} direct internal tools plus ` +
    `${guide.metaToolCount} meta tools for ${guide.protocolNamespaceCount} protocol namespaces.`
  );
}
