#!/usr/bin/env tsx
/**
 * tool-reembed — populate / refresh `tool_embeddings` in one synchronous pass.
 *
 * Workflow:
 *   1. Load .env (provider-neutral) so `VEX_DB_URL` + `EMBEDDING_*` are set.
 *   2. Run migrations (idempotent) — guarantees `010_tool_embeddings.sql` is
 *      applied before we try to insert.
 *   3. Call `reembedAllTools()` — single-flight, idempotent on `content_hash`.
 *   4. Print a one-line summary, exit 0 on success / non-zero on failure.
 *
 * Use this when developing locally and you want to know dense tool discovery
 * is ready before running the MCP server. Production MCP boots reembed in the
 * background (see `src/mcp/bootstrap.ts`); this script is the synchronous
 * equivalent.
 */

import { loadProviderDotenv } from "../../providers/env-resolution.js";
import { runMigrations } from "@vex-agent/db/migrate.js";
import { reembedAllTools } from "@vex-agent/tools/protocols/embeddings/reembed.js";
import { closePool } from "@vex-agent/db/client.js";
import logger from "@utils/logger.js";

async function main(): Promise<void> {
  loadProviderDotenv();
  await runMigrations();
  const report = await reembedAllTools();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    logger.error("tool_reembed.fatal", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.stderr.write(
      `tool-reembed failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    await closePool().catch(() => undefined);
    process.exit(1);
  });
