#!/usr/bin/env tsx
/**
 * tool-embeddings:health — quick sanity check for the tool_embeddings table.
 *
 * Loads env, checks that tool_embeddings is populated and consistent with the
 * current embedding generation (provider-reported model + returned dim + active
 * tool count). Exits 0 on pass, non-zero on failure.
 *
 * Usage: pnpm tool-embeddings:health
 */

import { loadProviderDotenv } from "../../providers/env-resolution.js";
import { assertToolEmbeddingsReady } from "@vex-agent/tools/protocols/embeddings/health.js";
import { closePool } from "@vex-agent/db/client.js";
import logger from "@utils/logger.js";

async function main(): Promise<void> {
  loadProviderDotenv();
  await assertToolEmbeddingsReady();
  // eslint-disable-next-line no-console
  console.log("tool_embeddings: OK");
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    logger.error("tool_embeddings.health.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.stderr.write(
      `tool-embeddings:health failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    await closePool().catch(() => undefined);
    process.exit(1);
  });
