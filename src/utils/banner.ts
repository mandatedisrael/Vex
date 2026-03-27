import chalk from "chalk";
import { isHeadless, writeStderr } from "./output.js";

// ── Brand color ───────────────────────────────────────────────────────────────

const B = chalk.rgb(46, 92, 255).bold;
const DIM = chalk.dim;

// ── Block-letter ECHOCLAW ─────────────────────────────────────────────────────

const BANNER_BLOCK = [
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557      \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557    \u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551    \u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551 \u2588\u2557 \u2588\u2588\u2551",
  "\u2588\u2588\u2554\u2550\u2550\u255d  \u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2588\u2557\u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2554\u2588\u2588\u2588\u2554\u255d",
  "\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u255d\u255a\u2550\u2550\u255d",
] as const;

export const BANNER_LINES = BANNER_BLOCK;

const BANNER_WIDTH = 67;

// ── Public API ────────────────────────────────────────────────────────────────

export interface BatBannerOptions {
  animated?: boolean;
  delayMs?: number;
  subtitle?: string;
  description?: string;
}

/**
 * Render the EchoClaw block-letter banner with optional framed subtitle.
 * Replaces the old animated bat banner. Same export name for compatibility.
 * `animated` and `delayMs` options are accepted but ignored (instant render).
 */
export async function renderBatBanner(options: BatBannerOptions = {}): Promise<boolean> {
  if (isHeadless()) {
    return false;
  }

  writeStderr("");
  for (const line of BANNER_BLOCK) {
    writeStderr(`  ${B(line)}`);
  }
  writeStderr("");

  // Framed subtitle
  const subtitleText = options.subtitle ?? "0G Network \u00b7 DeFi \u00b7 AI Compute";
  const innerWidth = BANNER_WIDTH - 2; // space between │ and │
  const textLen = subtitleText.length;
  const leftPad = Math.max(0, Math.floor((innerWidth - textLen) / 2));
  const rightPad = Math.max(0, innerWidth - textLen - leftPad);
  const paddedInner = " ".repeat(leftPad) + subtitleText + " ".repeat(rightPad);

  writeStderr(`  ${B("\u256d" + "\u2500".repeat(BANNER_WIDTH - 2) + "\u256e")}`);
  writeStderr(`  ${B("\u2502")}${chalk.whiteBright(paddedInner)}${B("\u2502")}`);
  writeStderr(`  ${B("\u2570" + "\u2500".repeat(BANNER_WIDTH - 2) + "\u256f")}`);

  if (options.description) {
    writeStderr(`  ${DIM(options.description)}`);
  }
  writeStderr("");

  return true;
}
