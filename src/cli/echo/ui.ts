import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeStderr } from "../../utils/output.js";
import type { ConnectorBundle } from "./connectors.js";
import type { EnvFieldStatus, WalletStatus } from "./status.js";

interface MenuItem<T extends string> {
  id: T;
  label: string;
  description: string;
  disabled?: boolean;
}

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  red: "\u001b[31m",
} as const;

function color(text: string, ansi: string): string {
  if (!stderr.isTTY) return text;
  return `${ansi}${text}${ANSI.reset}`;
}

function bold(text: string): string {
  return color(text, ANSI.bold);
}

export function assertInteractiveLauncher(): void {
  if (isHeadless() || stdin.isTTY !== true) {
    throw new EchoError(
      ErrorCodes.ONBOARD_REQUIRES_TTY,
      "echoclaw echo requires an interactive terminal.",
      "Run this command in a TTY session to complete the guided MCP setup.",
    );
  }
}

function writeBlankLine(): void {
  writeStderr("");
}

export function renderSection(title: string, description?: string): void {
  writeBlankLine();
  writeStderr(bold(title));
  if (description) {
    writeStderr(description);
  }
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({
    input: stdin,
    output: stderr,
  });

  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function promptMenu<T extends string>(
  title: string,
  items: readonly MenuItem<T>[],
): Promise<T> {
  while (true) {
    renderSection(title);

    items.forEach((item, index) => {
      const suffix = item.disabled ? color(" (Coming soon)", ANSI.dim) : "";
      writeStderr(`${index + 1}. ${item.label}${suffix}`);
      writeStderr(`   ${item.description}`);
    });

    const answer = (await ask("Select an option: ")).trim();
    const index = Number(answer);
    if (!Number.isInteger(index) || index < 1 || index > items.length) {
      writeStderr(color("Invalid selection. Please choose one of the listed numbers.", ANSI.red));
      continue;
    }

    const selected = items[index - 1]!;
    if (selected.disabled) {
      writeStderr(color(`${selected.label} is not available in this version yet.`, ANSI.yellow));
      continue;
    }

    return selected.id;
  }
}

export async function confirm(message: string, defaultValue: boolean = false): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n]: " : " [y/N]: ";
  const answer = (await ask(`${message}${suffix}`)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

export async function promptText(message: string, allowEmpty: boolean = false): Promise<string> {
  while (true) {
    const value = (await ask(`${message}: `)).trim();
    if (value || allowEmpty) return value;
    writeStderr(color("This field cannot be empty.", ANSI.red));
  }
}

export async function promptSecret(message: string): Promise<string> {
  assertInteractiveLauncher();

  return new Promise<string>((resolve, reject) => {
    const input = stdin;
    let value = "";

    writeStderr(`${message}: `);

    const cleanup = (): void => {
      input.removeListener("data", onData);
      if (typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }
      input.pause();
      writeBlankLine();
    };

    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");

      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new EchoError(ErrorCodes.SETUP_CANCELLED, "Setup cancelled by user."));
          return;
        }

        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value.trim());
          return;
        }

        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    if (typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }
    input.resume();
    input.on("data", onData);
  });
}

export function renderLauncherHeader(coreReady: boolean): void {
  writeBlankLine();
  if (coreReady) {
    writeStderr(color("Now you can connect your MCP to AI", ANSI.green));
  } else {
    writeStderr(color("Setting up your local EchoClaw MCP", ANSI.cyan));
  }
}

export function renderEnvStatuses(fields: readonly EnvFieldStatus[]): void {
  renderSection("Environment");

  for (const field of fields) {
    const statusText = field.status === "configured"
      ? color("Configured", ANSI.green)
      : color("Missing", ANSI.yellow);
    const requirement = field.required ? "(Required)" : "(Optional)";
    writeStderr(`- ${field.key} ${requirement}: ${statusText}`);
    writeStderr(`  ${field.description}`);
  }
}

export function renderWalletStatuses(wallets: readonly WalletStatus[]): void {
  renderSection("Wallets");

  for (const wallet of wallets) {
    const statusText = wallet.status === "configured"
      ? color("Configured", ANSI.green)
      : color("Missing", ANSI.yellow);
    const title = wallet.kind === "evm" ? "EVM wallet" : "Solana wallet";
    const address = wallet.address ? ` (${wallet.address})` : "";
    writeStderr(`- ${title}: ${statusText}${address}`);
    writeStderr(`  ${wallet.detail}`);
  }
}

export function renderSystemChecks(
  checks: ReadonlyArray<{ label: string; ok: boolean; detail: string }>,
): void {
  renderSection("System checks");

  for (const check of checks) {
    const statusText = check.ok ? color("OK", ANSI.green) : color("Missing", ANSI.red);
    writeStderr(`- ${check.label}: ${statusText}`);
    writeStderr(`  ${check.detail}`);
  }
}

export function renderConnectorDetails(bundle: ConnectorBundle, artifactBaseDir: string): void {
  renderSection(bundle.title, bundle.description);

  writeStderr(`Client config target: ${bundle.clientConfigPath}`);
  if (bundle.docsUrl) {
    writeStderr(`Official docs: ${bundle.docsUrl}`);
  }

  if (bundle.commandPreview) {
    writeBlankLine();
    writeStderr(bold("Ready command"));
    writeStderr(bundle.commandPreview);
  }

  writeBlankLine();
  writeStderr(bold("Generated artifacts"));
  for (const artifact of bundle.artifacts) {
    writeStderr(`- ${artifactBaseDir}/${artifact.fileName}`);
    writeStderr(`  ${artifact.description}`);
  }

  writeBlankLine();
  writeStderr(bold("Next steps"));
  for (const step of bundle.nextSteps) {
    writeStderr(`- ${step}`);
  }

  writeBlankLine();
  writeStderr(bold("Quickstart prompt"));
  for (const line of bundle.quickstartPrompt.split("\n")) {
    writeStderr(line);
  }
}
