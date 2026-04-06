/**
 * Echo Agent — Postgres connection pool + typed query helpers.
 *
 * Own pool, own connection string (ECHO_AGENT_DB_URL).
 * Does NOT share pool with legacy src/agent/db/client.ts.
 */

import pg from "pg";
import logger from "@utils/logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const explicitUrl = process.env.ECHO_AGENT_DB_URL;
    if (!explicitUrl) {
      // Loud warning: the fallback exists for dev convenience but the canonical
      // expectation is that ECHO_AGENT_DB_URL is set explicitly (matches the
      // compose stack on port 5777). A future PR may remove the fallback entirely.
      logger.warn("echo-db.pool.using_fallback_url", {
        hint: "ECHO_AGENT_DB_URL not set — using fallback postgresql://echo_agent:echo_agent@localhost:5777/echo_agent_test. Set explicitly to silence this warning.",
      });
    }
    const connectionString = explicitUrl
      ?? "postgresql://echo_agent:echo_agent@localhost:5777/echo_agent_test";
    pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
    pool.on("error", (err) => {
      logger.error("echo-db.pool.error", { error: err.message });
    });
  }
  return pool;
}

/** Run a query and return all rows typed as T. */
export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

/** Run a query and return the first row, or null. */
export async function queryOne<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await getPool().query<T>(sql, params);
  return result.rows[0] ?? null;
}

/** Run a mutation and return affected row count. */
export async function execute(sql: string, params?: unknown[]): Promise<number> {
  const result = await getPool().query(sql, params);
  return result.rowCount ?? 0;
}

/** Graceful shutdown — drain the pool. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("echo-db.pool.closed");
  }
}
