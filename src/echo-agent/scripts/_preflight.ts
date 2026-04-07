/**
 * Shared pre-flight checks for maintenance scripts.
 *
 * These guards exist because the maintenance commands (knowledge-export,
 * knowledge-import, knowledge-reembed) operate on production data and a
 * wrong-DB or stale-schema run is essentially data loss. The runtime path
 * (MCP server, internal tools) keeps using getPool() with the dev fallback
 * for backwards compatibility — that's a separate audit item, not in scope
 * here. Maintenance scripts MUST be stricter than runtime.
 *
 * Two checks:
 *   1. assertExplicitDbUrl — ECHO_AGENT_DB_URL must be set (no silent fallback
 *      to echo_agent_test). Operators backing up the wrong DB is a real
 *      data-loss scenario.
 *   2. assertSchemaUpToDate — knowledge_entries.content_hash column must
 *      exist. migrate.ts is strictly additive and won't re-apply the edited
 *      001_initial.sql, so a developer who pulled this branch on top of an
 *      old persistent dev volume gets a stale schema. We catch this at the
 *      script boundary with an explicit wipe instruction instead of leaking
 *      a low-level SQL `column does not exist` error.
 */

import { queryOne } from "@echo-agent/db/client.js";

/**
 * Refuses to proceed when ECHO_AGENT_DB_URL is unset / empty / whitespace.
 * Writes an actionable error to stderr and exits with code 2.
 */
export function assertExplicitDbUrl(commandName: string): void {
  const url = (process.env.ECHO_AGENT_DB_URL ?? "").trim();
  if (url.length === 0) {
    process.stderr.write(
      `${commandName}: ECHO_AGENT_DB_URL is required for maintenance commands.\n` +
        `Refusing to run with the dev fallback (echo_agent_test) — operating on\n` +
        `the wrong DB silently produces/consumes data and breaks recovery.\n\n` +
        `Set it explicitly:\n` +
        `  export ECHO_AGENT_DB_URL=postgresql://echo_agent:echo_agent@localhost:5777/echo_agent\n\n` +
        `Or source the dev .env:\n` +
        `  set -a; . docker/echo-agent/.env; set +a\n`,
    );
    process.exit(2);
  }
}

/**
 * Verifies that the schema includes the R1 portability columns/tables.
 * Run AFTER runMigrations() so a fresh DB gets the schema applied; if it's
 * still missing, the operator pulled this branch on top of an old volume.
 */
export async function assertSchemaUpToDate(): Promise<void> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'knowledge_entries' AND column_name = 'content_hash'
     ) AS exists`,
  );
  if (!row?.exists) {
    process.stderr.write(
      `knowledge_entries.content_hash column missing — your DB was created\n` +
        `with an older schema. migrate.ts is strictly additive and will not\n` +
        `re-apply the edited 001_initial.sql.\n\n` +
        `Wipe and recreate the volume:\n` +
        `  docker compose -f docker/echo-agent/docker-compose.dev.yml down -v\n` +
        `  docker compose -f docker/echo-agent/docker-compose.dev.yml up -d\n\n` +
        `WARNING: this destroys all local data. If you need to preserve it,\n` +
        `use 'pg_dump' MANUALLY first — knowledge-export will not work on\n` +
        `the old schema.\n`,
    );
    process.exit(2);
  }
}
