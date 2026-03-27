import chalk from "chalk";
import Table from "cli-table3";
import ora, { type Ora } from "ora";
import { writeStderr, isHeadless } from "./output.js";

// ── Brand color ───────────────────────────────────────────────────────────────

const BRAND = chalk.rgb(46, 92, 255);
const BRAND_BOLD = chalk.rgb(46, 92, 255).bold;

export const colors = {
  primary: BRAND,
  primaryBold: BRAND_BOLD,
  success: chalk.green,
  error: chalk.red,
  warn: chalk.yellow,
  info: BRAND,
  muted: chalk.gray,
  dim: chalk.dim,
  bold: chalk.bold,
  white: chalk.whiteBright,
  address: BRAND,
  value: chalk.whiteBright,
};

// ── Block-letter logo ─────────────────────────────────────────────────────────

const ECHOCLAW_BLOCK = [
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557      \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557    \u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551    \u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551 \u2588\u2557 \u2588\u2588\u2551",
  "\u2588\u2588\u2554\u2550\u2550\u255d  \u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2588\u2557\u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2554\u2588\u2588\u2588\u2554\u255d",
  "\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u255d\u255a\u2550\u2550\u255d",
] as const;

export function printLogo(): void {
  if (isHeadless()) return;
  writeStderr("");
  for (const line of ECHOCLAW_BLOCK) {
    writeStderr(`  ${BRAND_BOLD(line)}`);
  }
  writeStderr("");
  writeStderr(`  ${chalk.whiteBright("EchoClaw")} ${BRAND("\u00b7")} ${BRAND("0G Network")}`);
  writeStderr("");
}

// ── Spinner ───────────────────────────────────────────────────────────────────

interface NoopSpinner {
  start: () => NoopSpinner;
  succeed: (text?: string) => NoopSpinner;
  fail: (text?: string) => NoopSpinner;
  warn: (text?: string) => NoopSpinner;
  stop: () => NoopSpinner;
  text: string;
}

export function spinner(text: string): Ora | NoopSpinner {
  if (isHeadless()) {
    const noop: NoopSpinner = {
      start: () => noop,
      succeed: () => noop,
      fail: () => noop,
      warn: () => noop,
      stop: () => noop,
      text: "",
    };
    return noop;
  }
  return ora({
    text,
    color: "blue",
    spinner: "dots",
  });
}

// ── Unicode frame renderer ────────────────────────────────────────────────────

const FRAME_MIN_WIDTH = 40;
const FRAME_PAD = 2;

function stripAnsi(s: string): string {
  return s.replace(
    // eslint-disable-next-line no-control-regex
    /\x1B\[[0-9;]*m/g,
    "",
  );
}

function renderFrame(
  lines: string[],
  titleRaw: string,
  borderColor: (s: string) => string,
): string {
  const contentWidth = Math.max(
    FRAME_MIN_WIDTH,
    ...lines.map((l) => stripAnsi(l).length + FRAME_PAD * 2),
    stripAnsi(titleRaw).length + 4,
  );

  const pad = (text: string) => {
    const visible = stripAnsi(text).length;
    const right = Math.max(0, contentWidth - visible - FRAME_PAD);
    return " ".repeat(FRAME_PAD) + text + " ".repeat(right);
  };

  const top = borderColor(`  \u256d${"\u2500".repeat(contentWidth)}\u256e`);
  const titleLine = `  ${borderColor("\u2502")}${pad(titleRaw)}${borderColor("\u2502")}`;
  const sep = `  ${borderColor("\u2502")}${" ".repeat(contentWidth)}${borderColor("\u2502")}`;
  const bottom = borderColor(`  \u2570${"\u2500".repeat(contentWidth)}\u256f`);

  const body = lines.map((l) => `  ${borderColor("\u2502")}${pad(l)}${borderColor("\u2502")}`);

  return [top, titleLine, sep, ...body, bottom].join("\n");
}

export function successBox(title: string, content: string): void {
  if (isHeadless()) return;
  writeStderr("");
  writeStderr(renderFrame(content.split("\n"), `${chalk.green("\u2713")} ${chalk.bold(title)}`, BRAND));
  writeStderr("");
}

export function errorBox(title: string, content: string): void {
  if (isHeadless()) return;
  writeStderr("");
  writeStderr(renderFrame(content.split("\n"), `${chalk.red("\u2717")} ${chalk.bold(title)}`, chalk.red));
  writeStderr("");
}

export function infoBox(title: string, content: string): void {
  if (isHeadless()) return;
  writeStderr("");
  writeStderr(renderFrame(content.split("\n"), `${BRAND("\u2139")} ${chalk.bold(title)}`, BRAND));
  writeStderr("");
}

export function warnBox(title: string, content: string): void {
  if (isHeadless()) return;
  writeStderr("");
  writeStderr(renderFrame(content.split("\n"), `${chalk.yellow("\u26a0")} ${chalk.bold(title)}`, chalk.yellow));
  writeStderr("");
}

// ── Step headers ──────────────────────────────────────────────────────────────

export function stepHeader(n: number, total: number, label: string): void {
  if (isHeadless()) return;
  writeStderr(`  ${BRAND(`[${n}/${total}]`)} ${chalk.bold(label)}`);
  writeStderr(`  ${chalk.gray("\u2500".repeat(label.length + 6))}`);
}

// ── Status markers ────────────────────────────────────────────────────────────

export function markOk(text: string): string { return `  ${chalk.green("\u2713")} ${text}`; }
export function markFail(text: string): string { return `  ${chalk.red("\u2717")} ${text}`; }
export function markPending(text: string): string { return `  ${chalk.gray("\u25cb")} ${text}`; }
export function markWarn(text: string): string { return `  ${chalk.yellow("\u26a0")} ${text}`; }

// ── Tables ────────────────────────────────────────────────────────────────────

export interface TableColumn {
  header: string;
  width?: number;
}

export function createTable(columns: TableColumn[]): Table.Table {
  return new Table({
    head: columns.map((c) => BRAND(c.header)),
    colWidths: columns.map((c) => c.width ?? null),
    style: {
      head: [],
      border: ["gray"],
    },
  });
}

export function printTable(columns: TableColumn[], rows: string[][]): void {
  const table = createTable(columns);
  rows.forEach((row) => table.push(row));
  writeStderr(table.toString());
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatBalance(value: bigint, decimals: number, precision = 4): string {
  const divisor = 10n ** BigInt(decimals);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;

  const fractionalStr = fractionalPart.toString().padStart(decimals, "0").slice(0, precision);
  const trimmedFractional = fractionalStr.replace(/0+$/, "");

  if (trimmedFractional === "") {
    return integerPart.toLocaleString();
  }

  return `${integerPart.toLocaleString()}.${trimmedFractional}`;
}
