/**
 * Module-level handoff between the compose lifecycle (writer) and the
 * database migration handler (reader). The pgPort + pgPasswordPath pair
 * is sensitive enough that it MUST stay main-process-only — never
 * crosses the preload boundary, never reaches the renderer.
 *
 * The compose handler calls `setDbConnection(...)` after a successful
 * `running` / `reused` result. The database handler calls
 * `getDbConnection()` to derive a per-call `pg.Pool` (no shared global
 * pool — migrate runs are short-lived and the pool is closed after).
 */

export interface DbConnection {
  readonly pgPort: number;
  readonly pgPasswordPath: string;
}

let current: DbConnection | null = null;

export function setDbConnection(value: DbConnection | null): void {
  current = value;
}

export function getDbConnection(): DbConnection | null {
  return current;
}
