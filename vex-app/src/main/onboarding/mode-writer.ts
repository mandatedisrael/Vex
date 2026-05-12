/**
 * Mode configuration writer (M11 Step 7).
 *
 * Single atomic .env mutation via `appendMultipleToDotenvFile`'s
 * M11-extended Record<string, string | null> signature — null entries
 * are deleted in the same temp+rename so switching mode to "chat"
 * removes AGENT_LOOP_MODE + AGENT_INITIAL_PROMPT in one shot. Mirrors
 * the M10 provider-writer pattern (no partial state on the wire).
 *
 * Caller (IPC handler) wraps in `withEnvWriteLock`.
 *
 * Logging: only canonical key NAMES + counts. NEVER the user's
 * mission goal / autonomous seed prompt (those can carry sensitive
 * intent the operator does not want in logs).
 */

import { appendMultipleToDotenvFile } from "@vex-lib/dotenv.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  MODE_ENV_KEYS,
  type ModeEnvKey,
  type ModeSetInput,
  type ModeSetResult,
} from "@shared/schemas/mode.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";

export interface ModeWriterOptions {
  readonly envFile?: string;
}

function buildUpdates(
  input: ModeSetInput,
): Record<ModeEnvKey, string | null> {
  if (input.mode === "chat") {
    return {
      AGENT_MODE: "chat",
      AGENT_LOOP_MODE: null,
      AGENT_INITIAL_PROMPT: null,
    };
  }
  if (input.mode === "mission") {
    return {
      AGENT_MODE: "mission",
      AGENT_LOOP_MODE: input.loopMode,
      AGENT_INITIAL_PROMPT: input.initialPrompt,
    };
  }
  return {
    AGENT_MODE: "full_autonomous",
    AGENT_LOOP_MODE: null,
    AGENT_INITIAL_PROMPT: input.initialPrompt ?? null,
  };
}

function partition(
  updates: Record<ModeEnvKey, string | null>,
): { written: ReadonlyArray<ModeEnvKey>; deleted: ReadonlyArray<ModeEnvKey> } {
  const written: ModeEnvKey[] = [];
  const deleted: ModeEnvKey[] = [];
  for (const key of MODE_ENV_KEYS) {
    if (updates[key] === null) {
      deleted.push(key);
    } else {
      written.push(key);
    }
  }
  return { written, deleted };
}

export async function writeMode(
  input: ModeSetInput,
  options: ModeWriterOptions = {},
): Promise<Result<ModeSetResult>> {
  const targetFile = options.envFile ?? ENV_FILE;
  const updates = buildUpdates(input);

  try {
    appendMultipleToDotenvFile(updates, targetFile);
  } catch (cause) {
    log.error(
      `[mode-writer] failed to persist mode keys to ${targetFile}`,
      cause,
    );
    return err({
      code: "onboarding.env_persist_failed",
      domain: "onboarding",
      message:
        "Couldn't save mode configuration to disk. Check disk space and permissions, then retry.",
      retryable: true,
      userActionable: true,
      redacted: true,
    });
  }

  const { written, deleted } = partition(updates);
  log.info(
    `[mode-writer] mode=${input.mode} wrote=${written.length} deleted=${deleted.length}`,
  );
  return ok({
    fieldsWritten: written,
    fieldsDeleted: deleted,
  });
}
