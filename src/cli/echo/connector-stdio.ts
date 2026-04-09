import { getMcpCliEntryPath } from "./package-assets.js";

export interface StdioInvocation {
  command: string;
  args: string[];
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function getStdioInvocation(): StdioInvocation {
  return {
    command: process.execPath,
    args: [getMcpCliEntryPath()],
  };
}

export function formatShellCommand(command: string, args: readonly string[]): string {
  return [shellQuote(command), ...args.map((arg) => shellQuote(arg))].join(" ");
}

export function buildRootMcpConfig(
  invocation: StdioInvocation,
): { mcpServers: Record<string, { command: string; args?: string[] }> } {
  return {
    mcpServers: {
      echoclaw: {
        command: invocation.command,
        args: invocation.args,
      },
    },
  };
}

export function buildClaudeServerConfig(
  invocation: StdioInvocation,
): { type: "stdio"; command: string; args: string[]; env: Record<string, string> } {
  return {
    type: "stdio",
    command: invocation.command,
    args: invocation.args,
    env: {},
  };
}

export function buildOpenClawServerConfig(
  invocation: StdioInvocation,
): { command: string; args: string[] } {
  return {
    command: invocation.command,
    args: invocation.args,
  };
}
