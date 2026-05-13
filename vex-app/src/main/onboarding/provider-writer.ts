/**
 * Provider configuration writer (M10 Step 6).
 *
 * Atomic 3-key batch write — `appendMultipleToDotenvFile` does a
 * single read → strip all existing occurrences of every key → append
 * canonical values → temp+rename + mode 0o600. This is the codex
 * turn 2 RED #2 fix: 3 separate `appendToDotenvFile` calls only
 * serialise via `withEnvWriteLock`; they do NOT make the multi-key
 * update transactional, and a stale unsupported `AGENT_PROVIDER`
 * (manual edit / future code) would silently override the wizard's
 * choice via engine precedence (`registry.ts:47-69`).
 *
 * Writes 3 keys in canonical order:
 *   1. OPENROUTER_API_KEY
 *   2. AGENT_MODEL
 *   3. AGENT_PROVIDER=openrouter   (explicit override of any stale value)
 *
 * Caller (IPC handler) wraps this in `withEnvWriteLock`.
 *
 * Logging: only canonical key NAMES + correlationId via the caller.
 * The writer itself logs only the file path on success. NEVER logs
 * apiKey value, length, model value, or any prefix/suffix preview.
 */

import { appendMultipleToDotenvFile } from "@vex-lib/dotenv.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  PROVIDER_PERSIST_CANONICAL_ORDER,
  type ProviderPersistInput,
} from "@shared/schemas/provider.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";

export interface ProviderWriterOptions {
  /** Override `ENV_FILE` for tests; production callers omit. */
  readonly envFile?: string;
}

type CanonicalKey = (typeof PROVIDER_PERSIST_CANONICAL_ORDER)[number];

const PROVIDER_AGENT_VALUE = "openrouter";

export interface ProviderWriteResult {
  readonly fieldsWritten: ReadonlyArray<CanonicalKey>;
}

/**
 * Persists the 3 provider .env keys atomically. Returns the full
 * canonical fieldsWritten array on success — partial-write recovery
 * is impossible with a single read-modify-write batch (either the
 * temp+rename succeeds and ALL 3 keys are in the final file, or it
 * fails and NONE are).
 */
export async function writeProvider(
  input: ProviderPersistInput,
  options: ProviderWriterOptions = {},
): Promise<Result<ProviderWriteResult>> {
  const targetFile = options.envFile ?? ENV_FILE;

  const updates: Record<CanonicalKey, string> = {
    OPENROUTER_API_KEY: input.apiKey,
    AGENT_MODEL: input.model,
    AGENT_PROVIDER: PROVIDER_AGENT_VALUE,
  };

  try {
    appendMultipleToDotenvFile(updates, targetFile);
  } catch (cause) {
    log.error(
      `[provider-writer] failed to persist provider keys to ${targetFile}`,
      cause,
    );
    return err({
      code: "onboarding.env_persist_failed",
      domain: "onboarding",
      message:
        "Couldn't save provider configuration to disk. Check disk space and permissions, then retry.",
      retryable: true,
      userActionable: true,
      redacted: true,
      details: { verified: true, partialFieldsWritten: [] },
    });
  }

  log.info(`[provider-writer] persisted provider keys to ${targetFile}`);
  return ok({
    fieldsWritten: [...PROVIDER_PERSIST_CANONICAL_ORDER] as ReadonlyArray<CanonicalKey>,
  });
}
