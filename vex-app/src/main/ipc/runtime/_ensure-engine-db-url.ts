/**
 * `ensureEngineDbUrl` — point the engine's lazy pg pool at the local
 * Postgres before any runtime IPC handler reaches into engine code.
 *
 * Mirrors the pattern in `chat.ts ensureEngineDbUrl`; extracted to a
 * shared helper so all five runtime handlers stay short.
 *
 * NOTE: this mutates `process.env.VEX_DB_URL` and resets the engine
 * pool if the resolved URL differs from the cached one. Concurrent
 * callers see the same env mutation; the pool reset is idempotent
 * (`closePool` no-ops once drained).
 */

import { URL } from "node:url";
import { ok, err, type Result, type VexError } from "@shared/ipc/result.js";
import { closePool } from "@vex-agent/db/client.js";
import { buildPoolConfig } from "../../database/db-config.js";
import { dbUnavailableError } from "./_errors.js";

function makePostgresUrl(args: {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}): string {
  const url = new URL(
    `postgresql://${args.host}:${args.port}/${args.database}`,
  );
  url.username = args.user;
  url.password = args.password;
  return url.toString();
}

export async function ensureEngineDbUrl(
  correlationId: string,
): Promise<Result<void, VexError>> {
  try {
    const cfg = await buildPoolConfig();
    if (cfg === null) return err(dbUnavailableError(correlationId));
    const nextUrl = makePostgresUrl(cfg);
    if (process.env.VEX_DB_URL === nextUrl) return ok(undefined);
    process.env.VEX_DB_URL = nextUrl;
    await closePool();
    return ok(undefined);
  } catch {
    return err(dbUnavailableError(correlationId));
  }
}
