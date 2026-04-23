#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { EchoError, ErrorCodes } from "../errors.js";
import { writeStderr } from "../utils/output.js";
import { suppressDep0040Warnings } from "./shared/warnings.js";

export function buildRootHelpText(): string {
  return [
    "Usage:",
    "  echoclaw <command>",
    "",
    "Commands:",
    "  echo   Launch the EchoClaw MCP setup and AI connector flow.",
    "  mcp    Start the production MCP server directly.",
    "  help   Show this help message.",
  ].join("\n");
}

function printRootHelp(): void {
  for (const line of buildRootHelpText().split("\n")) {
    writeStderr(line);
  }
}

function printCliError(error: unknown): void {
  if (error instanceof EchoError) {
    writeStderr(error.message);
    if (error.hint) {
      writeStderr(`Hint: ${error.hint}`);
    }
    return;
  }

  writeStderr(error instanceof Error ? error.message : String(error));
}

export async function runRootCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printRootHelp();
    return;
  }

  if (command === "echo") {
    suppressDep0040Warnings();
    const { runEchoCli } = await import("./echo/index.js");
    await runEchoCli(rest);
    return;
  }

  if (command === "mcp") {
    const { runMcpCli } = await import("../mcp/index.js");
    await runMcpCli(rest);
    return;
  }

  throw new EchoError(
    ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    `Unknown echoclaw command: ${command}`,
    "Use `echoclaw help` to inspect the available commands.",
  );
}

const isDirectInvocation = import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;

if (isDirectInvocation) {
  runRootCli().catch((error) => {
    printCliError(error);
    process.exit(error instanceof EchoError && error.code === ErrorCodes.SETUP_CANCELLED ? 130 : 1);
  });
}
