/**
 * Starter ledger rows shown under an empty conversation's composer (S2
 * rebrand — the six icon chips became three numbered rows). Pure data —
 * each row seeds the composer draft with a prompt. Hidden in mission mode
 * and once the transcript has messages.
 */

export interface QuickAction {
  readonly label: string;
  readonly prompt: string;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    label: "Check my wallet balances and recent activity",
    prompt: "Check my wallet balances and recent activity.",
  },
  {
    label: "Plan a swap — show me the route before anything moves",
    prompt:
      "Plan a swap for me — show me the full route and costs before anything moves.",
  },
  {
    label: "Set up a mission that watches gas and reports daily",
    prompt: "Set up a mission that watches gas prices and reports to me daily.",
  },
];
