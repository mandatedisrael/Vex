import {
  buildDirectToolRoutingLines,
  buildMemoryPolicyLines,
  buildOnboardingReadOrderLines,
  buildSurfaceSummaryLine,
} from "../../mcp/docs/onboarding.js";

export const QUICKSTART_PROMPT_FILE_NAME = "quickstart.prompt.md";
export const QUICKSTART_PROMPT_DESCRIPTION =
  "Starter text to paste into the AI after the MCP is connected.";

export function buildQuickstartPrompt(): string {
  return [
    "You are connected to EchoClaw MCP.",
    buildSurfaceSummaryLine(),
    "",
    "Read these resources in order before choosing tools:",
    ...buildOnboardingReadOrderLines(),
    "",
    "How to route tool calls:",
    ...buildDirectToolRoutingLines(),
    "",
    "Memory policy:",
    ...buildMemoryPolicyLines(),
    "",
    "Mutation policy:",
    "- For fund-moving actions, read or preview first when a quote, dry-run, or prepare step exists.",
    "- Your MCP host's permission UX is the execution gate. Do not invent a second approval flow inside EchoClaw.",
    "- If Polymarket trading is gated, use polymarket_setup instead of telling the user to edit POLYMARKET_API_KEY.",
    "- Check runtime://env for missing credentials before assuming a protocol is unavailable.",
    "",
    "Navigation tips:",
    "- Use docs://tools when the task sounds like memory, notes, wallet, portfolio, web research, EVM, or setup.",
    "- Use docs://protocols when the task is protocol-specific, then narrow with docs://protocols/{namespace} before discover_tools.",
    "- Use surface://manifest only when you need the raw machine-readable snapshot.",
  ].join("\n");
}
