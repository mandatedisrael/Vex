/**
 * Wake configuration writer (M11 Step 8).
 *
 * Single atomic .env mutation: when `enabled: false`, the writer
 * DELETES AGENT_WAKE_INTERVAL_MS + AGENT_WAKE_BATCH_SIZE in the same
 * temp+rename that flips AGENT_WAKE_ENABLED to "false". Prevents the
 * stale-key drift M10 fixed for provider state (codex v2 RED).
 *
 * Caller wraps in `withEnvWriteLock`. Engine consumes these env keys
 * at MCP startup via `src/mcp/wake-config.ts`, so the toggle becomes
 * effective on the next process boot.
 */

import { appendMultipleToDotenvFile } from "@vex-lib/dotenv.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  WAKE_ENV_KEYS,
  type WakeEnvKey,
  type WakeSetInput,
  type WakeSetResult,
} from "@shared/schemas/wake.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";

export interface WakeWriterOptions {
  readonly envFile?: string;
}

function buildUpdates(
  input: WakeSetInput,
): Record<WakeEnvKey, string | null> {
  if (input.enabled) {
    return {
      AGENT_WAKE_ENABLED: "true",
      AGENT_WAKE_INTERVAL_MS: String(input.intervalMs),
      AGENT_WAKE_BATCH_SIZE: String(input.batchSize),
    };
  }
  return {
    AGENT_WAKE_ENABLED: "false",
    AGENT_WAKE_INTERVAL_MS: null,
    AGENT_WAKE_BATCH_SIZE: null,
  };
}

function partition(
  updates: Record<WakeEnvKey, string | null>,
): { written: ReadonlyArray<WakeEnvKey>; deleted: ReadonlyArray<WakeEnvKey> } {
  const written: WakeEnvKey[] = [];
  const deleted: WakeEnvKey[] = [];
  for (const key of WAKE_ENV_KEYS) {
    if (updates[key] === null) {
      deleted.push(key);
    } else {
      written.push(key);
    }
  }
  return { written, deleted };
}

export async function writeWake(
  input: WakeSetInput,
  options: WakeWriterOptions = {},
): Promise<Result<WakeSetResult>> {
  const targetFile = options.envFile ?? ENV_FILE;
  const updates = buildUpdates(input);

  try {
    appendMultipleToDotenvFile(updates, targetFile);
  } catch (cause) {
    log.error(
      `[wake-writer] failed to persist wake keys to ${targetFile}`,
      cause,
    );
    return err({
      code: "onboarding.env_persist_failed",
      domain: "onboarding",
      message:
        "Couldn't save wake configuration to disk. Check disk space and permissions, then retry.",
      retryable: true,
      userActionable: true,
      redacted: true,
    });
  }

  const { written, deleted } = partition(updates);
  log.info(
    `[wake-writer] enabled=${input.enabled} wrote=${written.length} deleted=${deleted.length}`,
  );
  return ok({
    fieldsWritten: written,
    fieldsDeleted: deleted,
  });
}
