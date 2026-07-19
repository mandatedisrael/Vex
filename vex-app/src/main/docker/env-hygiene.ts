/**
 * Strips managed secrets out of an environment before it is handed to a
 * spawned Docker/child process. Docker CLI/probe/compose helpers only need
 * operational vars (PATH, DOCKER_HOST, HOME, …); they must never inherit the
 * master password or vault-managed API secrets that happen to live in
 * `process.env` for the lifetime of the app.
 */

import { MANAGED_SECRET_ENV_KEYS } from "@vex-lib/secret-keys.js";

// Windows env var names are case-insensitive and preserve first-set casing,
// so a mixed-case duplicate of a managed key must be stripped too.
const MANAGED_SECRET_ENV_KEYS_LOWER = new Set(
  MANAGED_SECRET_ENV_KEYS.map((key) => key.toLowerCase()),
);

/**
 * Returns a new env object with every `MANAGED_SECRET_ENV_KEYS` entry
 * removed (case-insensitive). Never mutates `env`, even when `env` is
 * `process.env` itself.
 */
export function withoutManagedSecrets(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const stripped: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (MANAGED_SECRET_ENV_KEYS_LOWER.has(key.toLowerCase())) continue;
    stripped[key] = value;
  }
  return stripped;
}
