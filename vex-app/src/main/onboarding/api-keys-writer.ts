/**
 * API keys writer (M9 Step 3).
 *
 * Writes the optional set of API keys + the all-or-none Polymarket
 * trio into `${CONFIG_DIR}/.env` atomically. Caller wraps in
 * `withEnvWriteLock`.
 *
 * Polymarket trio:
 *   The schema's `polymarket?: { apiKey, apiSecret, passphrase }`
 *   already enforces "all 3 or none" at the input boundary (the
 *   nested object is `strict()` with all 3 fields required when
 *   present). We re-assert at the writer with a defensive coherence
 *   check so a future schema relaxation can't silently break the
 *   invariant — defense-in-depth.
 *
 * Logging: only the canonical key NAMES being written get logged.
 * NEVER the value, the length, or any prefix/suffix preview. The
 * envelope returned to the renderer carries `fieldsWritten` in
 * canonical order so UI can render "Set: JUPITER_API_KEY, ..."
 * without secrets crossing the boundary.
 */

import { appendToDotenvFile } from "@vex-lib/dotenv.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  API_KEYS_CANONICAL_ORDER,
  type ApiKeysSetInput,
  type ApiKeysSetResult,
} from "@shared/schemas/api-keys.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";

export interface ApiKeysWriterOptions {
  /** Override `ENV_FILE` for tests; production callers omit. */
  readonly envFile?: string;
}

type CanonicalKey = (typeof API_KEYS_CANONICAL_ORDER)[number];

export async function writeApiKeys(
  input: ApiKeysSetInput,
  options: ApiKeysWriterOptions = {}
): Promise<Result<ApiKeysSetResult>> {
  const targetFile = options.envFile ?? ENV_FILE;

  // Defensive trio coherence check (schema already enforces; this
  // closes the gap if the schema is ever relaxed).
  if (input.polymarket !== undefined) {
    const trio = input.polymarket;
    if (
      trio.apiKey.length === 0 ||
      trio.apiSecret.length === 0 ||
      trio.passphrase.length === 0
    ) {
      return err({
        code: "validation.invalid_input",
        domain: "onboarding",
        message:
          "Polymarket credentials must include api key, api secret, and passphrase.",
        retryable: false,
        userActionable: true,
        redacted: true,
      });
    }
  }

  // Build the write plan in canonical order so fieldsWritten is
  // deterministic regardless of object iteration order.
  const writes: Array<{ key: CanonicalKey; value: string }> = [];
  if (input.jupiterApiKey !== undefined) {
    writes.push({ key: "JUPITER_API_KEY", value: input.jupiterApiKey });
  }
  if (input.tavilyApiKey !== undefined) {
    writes.push({ key: "TAVILY_API_KEY", value: input.tavilyApiKey });
  }
  if (input.rettiwtApiKey !== undefined) {
    writes.push({ key: "RETTIWT_API_KEY", value: input.rettiwtApiKey });
  }
  if (input.polymarket !== undefined) {
    writes.push({ key: "POLYMARKET_API_KEY", value: input.polymarket.apiKey });
    writes.push({ key: "POLYMARKET_API_SECRET", value: input.polymarket.apiSecret });
    writes.push({ key: "POLYMARKET_PASSPHRASE", value: input.polymarket.passphrase });
  }

  if (writes.length === 0) {
    // Nothing to write — empty submission is a legal Continue.
    return ok({ fieldsWritten: [] });
  }

  const fieldsWritten: CanonicalKey[] = [];
  for (const w of writes) {
    try {
      appendToDotenvFile(w.key, w.value, targetFile);
      fieldsWritten.push(w.key);
    } catch (cause) {
      log.error(
        `[api-keys-writer] failed to persist ${w.key} to ${targetFile}`,
        cause
      );
      // Partial-write recovery: surface what got through so the
      // renderer can update its skip-card optimistically and the
      // user knows which keys still need a retry.
      return err({
        code: "onboarding.env_persist_failed",
        domain: "onboarding",
        message: `Could not persist ${w.key}. Check disk space and permissions.`,
        retryable: true,
        userActionable: true,
        redacted: true,
        details: { partialFieldsWritten: fieldsWritten },
      });
    }
  }

  log.info(
    `[api-keys-writer] persisted keys=${fieldsWritten.join(",")}`
  );
  return ok({ fieldsWritten });
}
