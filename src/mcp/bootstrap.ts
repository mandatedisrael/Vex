/**
 * Production MCP — boot sequence.
 *
 * fail-fast pipeline executed before any transport is bound:
 *   1. loadProviderDotenv() — pulls the same `ENV_FILE` Vex Agent uses.
 *   2. validateRequiredEnv() — explicit VEX_DB_URL + EMBEDDING_* + JUPITER_API_KEY.
 *   3. runMigrations() — idempotent additive migration runner.
 *   4. probeAll() — DB ping + embeddings round-trip.
 *
 * Any failure exits process with code 2 and a structured stderr message.
 * The actual server factory + transport bind happens in src/mcp/index.ts
 * after `bootstrap()` returns.
 */

import { runMigrations } from "@vex-agent/db/migrate.js";
import { loadProviderDotenv } from "../providers/env-resolution.js";
import { McpHealthError, probeAll } from "./runtime/health.js";
import { reembedAllTools } from "@vex-agent/tools/protocols/embeddings/reembed.js";
import logger from "@utils/logger.js";

export const REQUIRED_ENV = [
  "VEX_DB_URL",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIM",
  "EMBEDDING_PROVIDER",
  "JUPITER_API_KEY",
] as const;

export class McpBootstrapError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "McpBootstrapError";
  }
}

export function validateRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !(process.env[k] ?? "").trim());
  if (missing.length === 0) return;
  throw new McpBootstrapError(
    `Missing required env: ${missing.join(", ")}`,
    "Set them in your app .env (CONFIG_DIR/.env) or pass via the MCP host config. " +
      "Vex MCP shares the same env contract as Vex Agent — see docker/vex-agent/.env.example.",
  );
}

/**
 * Shared bootstrap checks without dotenv loading or process exit.
 *
 * Used by the launcher to validate readiness before generating client
 * connector instructions. Throws structured errors instead of exiting.
 */
export async function runBootstrapChecks(): Promise<void> {
  validateRequiredEnv();

  try {
    await runMigrations();
  } catch (err) {
    throw new McpBootstrapError(
      err instanceof Error ? `Migrations failed: ${err.message}` : `Migrations failed: ${String(err)}`,
      "Inspect the Postgres logs and ensure the user has CREATE privileges on the DB.",
    );
  }

  try {
    await probeAll();
  } catch (err) {
    if (err instanceof McpHealthError) {
      throw err;
    }

    throw new McpHealthError(
      err instanceof Error ? `Health probe failed: ${err.message}` : `Health probe failed: ${String(err)}`,
    );
  }

  // Tool embeddings reembed — non-blocking. Bootstrap returns immediately;
  // the run logs `tool_embeddings.reembed.completed` when finished. If the
  // embedding service is unavailable, the catch keeps startup quiet and
  // `discover_tools` degrades to lexical scoring at runtime.
  void reembedAllTools().catch((err) => {
    logger.warn("mcp.bootstrap.reembed.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Run the boot sequence. On success returns `void` and the caller can build
 * the McpServer + bind a transport. On failure writes a structured message
 * to stderr and exits the process with code 2 (no recovery is sensible).
 */
export async function bootstrap(): Promise<void> {
  // 1. Load provider-neutral .env from CONFIG_DIR/.env (same path Vex Agent reads).
  try {
    loadProviderDotenv();
  } catch (err) {
    failFast(
      "Failed to load provider .env",
      err instanceof Error ? err.message : String(err),
      "Check that CONFIG_DIR/.env exists and is readable.",
    );
  }

  try {
    await runBootstrapChecks();
  } catch (err) {
    if (err instanceof McpBootstrapError) {
      const prefix = err.message.startsWith("Migrations failed:")
        ? "MCP bootstrap: migrations failed"
        : "MCP bootstrap: env validation failed";
      failFast(prefix, err.message, err.hint);
    }
    if (err instanceof McpHealthError) {
      failFast("MCP bootstrap: health probe failed", err.message, err.hint);
    }
    failFast(
      "MCP bootstrap: health probe failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  logger.info("mcp.bootstrap.ok");
}

function failFast(prefix: string, detail: string, hint?: string): never {
  const lines = [`${prefix}: ${detail}`];
  if (hint) lines.push(`Hint: ${hint}`);
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(2);
}
