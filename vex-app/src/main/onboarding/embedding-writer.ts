/**
 * Embedding configuration writer (M9 Step 4).
 *
 * Pipeline:
 *   1. Normalize baseUrl (strip trailing "/" — matches the engine
 *      reader in `src/vex-agent/embeddings/config.ts`).
 *   2. Read current EMBEDDING_DIM from .env.
 *   3. If new dim === existing dim → SKIP the DB query (no lock
 *      check needed; same dim is always safe). Resolves the
 *      D7 over-blocking concern from codex turn 3.
 *   4. Else (dim changed OR no existing dim) → run the dim-lock
 *      query. Any row whose `embedding_dim <> targetDim` blocks
 *      the write with `embedding.dim_locked`. DB connect / query
 *      failure surfaces as `embedding.db_unavailable`.
 *   5. Persist the 4 EMBEDDING_* keys atomically (each call is its
 *      own atomic temp+rename; we run them sequentially so a
 *      mid-batch crash leaves a coherent prefix).
 *
 * Caller (IPC handler) wraps the call in `withEnvWriteLock`.
 *
 * Validation matches engine semantics:
 *   - dim range MIN_EMBEDDING_DIM..MAX_EMBEDDING_DIM (1..8192)
 *   - baseUrl http(s):// with hostname (stricter than engine's
 *     startsWith — see schema)
 *   - model + provider non-empty
 */

import { appendToDotenvFile, readDotenvFileValue } from "@vex-lib/dotenv.js";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import type {
  EmbeddingConfigureInput,
  EmbeddingConfigureResult,
} from "@shared/schemas/embedding.js";
import { ENV_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";
import { countRowsWithDimNotMatching } from "../database/dim-lock.js";
import { stripManagedSecretsFromDotenvFile } from "@vex-lib/local-secret-vault.js";

export interface EmbeddingWriterOptions {
  /** Override `ENV_FILE` for tests; production callers omit. */
  readonly envFile?: string;
  /** Override DB checker for tests — defaults to the real pg client. */
  readonly countMismatchedRows?: (targetDim: number) => Promise<Result<number, VexError>>;
}

const KEYS = [
  "EMBEDDING_BASE_URL",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIM",
  "EMBEDDING_PROVIDER",
] as const;

function normalizeBaseUrl(raw: string): string {
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function readCurrentDim(envFile: string): number | null {
  let raw: string | null;
  try {
    raw = readDotenvFileValue("EMBEDDING_DIM", envFile);
  } catch {
    return null;
  }
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function writeEmbeddingConfig(
  input: EmbeddingConfigureInput,
  options: EmbeddingWriterOptions = {},
): Promise<Result<EmbeddingConfigureResult>> {
  const targetFile = options.envFile ?? ENV_FILE;
  const checker =
    options.countMismatchedRows ?? countRowsWithDimNotMatching;

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const currentDim = readCurrentDim(targetFile);
  const dimChanged = currentDim !== input.dim;

  // Only consult the DB when the dim is actually changing. A pure
  // BASE_URL / MODEL / PROVIDER update with the same dim is safe
  // without DB access — the existing vectors stay valid.
  if (dimChanged) {
    const countResult = await checker(input.dim);
    if (!countResult.ok) {
      return countResult;
    }
    if (countResult.data > 0) {
      return err({
        code: "embedding.dim_locked",
        domain: "embedding",
        message:
          `Existing long-term memory entries use a different embedding dimension. ` +
          `Changing to dim=${input.dim} would make ${countResult.data} entries unavailable ` +
          `until you export, wipe, and re-import them.`,
        retryable: false,
        userActionable: true,
        redacted: true,
        details: { existingRowCount: countResult.data, targetDim: input.dim },
      });
    }
  }

  // Write all four keys in canonical order. Sequential, not parallel,
  // because appendToDotenvFile is read-modify-write — concurrent
  // writes within the same .env would race. (The IPC handler also
  // wraps this whole call in withEnvWriteLock for cross-IPC safety.)
  const writes: Array<{ key: (typeof KEYS)[number]; value: string }> = [
    { key: "EMBEDDING_BASE_URL", value: baseUrl },
    { key: "EMBEDDING_MODEL", value: input.model },
    { key: "EMBEDDING_DIM", value: String(input.dim) },
    { key: "EMBEDDING_PROVIDER", value: input.provider },
  ];

  stripManagedSecretsFromDotenvFile(targetFile);

  for (const w of writes) {
    try {
      appendToDotenvFile(w.key, w.value, targetFile);
    } catch (cause) {
      log.error(
        `[embedding-writer] failed to persist ${w.key} to ${targetFile}`,
        cause,
      );
      return err({
        code: "onboarding.env_persist_failed",
        domain: "onboarding",
        message: `Could not persist ${w.key}. Check disk space and permissions.`,
        retryable: true,
        userActionable: true,
        redacted: true,
      });
    }
  }

  log.info(
    `[embedding-writer] persisted EMBEDDING_* dim=${input.dim} dimChanged=${dimChanged}`,
  );
  return ok({ written: true, dimChanged });
}
