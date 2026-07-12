/** Shared OpenRouter request identity for Electron main integrations. */

export const OPENROUTER_APP_URL = "https://vexlabs.ai";
export const OPENROUTER_APP_TITLE = "Vex Agent";

/**
 * The SDK falls back to `console` when OPENROUTER_DEBUG is enabled. Supplying
 * a no-op logger prevents request headers, including Authorization, from
 * reaching process logs.
 */
export const OPENROUTER_NOOP_LOGGER = {
  group: () => {},
  groupEnd: () => {},
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
