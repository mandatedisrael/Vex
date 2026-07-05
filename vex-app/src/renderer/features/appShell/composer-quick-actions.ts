/**
 * Starter chips shown under an empty conversation's composer — three compact
 * hairline chips DETACHED below the Signal Console, each with a small intent
 * icon (a wallet, a swap/exchange, a fuel gauge). Pure data — each chip seeds
 * the composer draft with its full-sentence prompt; the short label is what the
 * chip renders. Hidden in mission mode and once the transcript has messages.
 */

import type { IconSvgElement } from "@hugeicons/react";
import {
  Exchange01Icon,
  Fuel01Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";

export interface QuickAction {
  readonly label: string;
  readonly prompt: string;
  /** hugeicons glyph matching the chip's intent (rendered via HugeiconsIcon). */
  readonly icon: IconSvgElement;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    label: "Wallet balances & activity",
    prompt: "Check my wallet balances and recent activity.",
    icon: Wallet01Icon,
  },
  {
    label: "Plan a swap — route first",
    prompt:
      "Plan a swap for me — show me the full route and costs before anything moves.",
    icon: Exchange01Icon,
  },
  {
    label: "Watch gas, report daily",
    prompt: "Set up a mission that watches gas prices and reports to me daily.",
    icon: Fuel01Icon,
  },
];
