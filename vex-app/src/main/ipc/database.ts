/**
 * vex.database.* — Postgres migration IPC surface (M6).
 *
 * `migrate()` runs `runMigrationsForIpc()` from `../database/migrate-runner.ts`
 * with single-flight deduplication so React StrictMode dev double-mount
 * + concurrent renderer invokes share one underlying migrate run.
 *
 * Failure surface: `kind: "failed"` from the runner is mapped to
 * `err({ code: "data.migration_failed", details: { failedAt } })` —
 * NOT to a success kind. Two error channels would split renderer
 * branching logic and break `Result<T, VexError>` semantics
 * (codex turn 1 RED #1).
 */

import { CH, EV } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  migrateInputSchema,
  migrateResultSchema,
  type MigrateResult,
} from "@shared/schemas/database.js";
import { migrationProgressBus } from "../database/progress-bus.js";
import {
  runMigrationsForIpc,
  type MigrateRunResult,
} from "../database/migrate-runner.js";
import { broadcastToAllWindows } from "../lifecycle/broadcast.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

const PROGRESS_CHANNEL = EV.database.migrateProgress;

function broadcastMigrationProgress(): () => void {
  return migrationProgressBus.subscribe((payload) =>
    broadcastToAllWindows(PROGRESS_CHANNEL, payload)
  );
}

function mapToResult(
  runResult: MigrateRunResult,
  correlationId: string
): Result<MigrateResult> {
  if (runResult.kind === "applied") {
    return ok({
      kind: "applied",
      applied: runResult.applied,
      files: runResult.files,
      message: runResult.message,
    });
  }
  if (runResult.kind === "noop") {
    return ok({ kind: "noop", message: runResult.message });
  }
  // kind === "failed"
  const details =
    runResult.failedAt !== null
      ? {
          failedAt: {
            version: runResult.failedAt.version,
            file: runResult.failedAt.file,
          },
        }
      : undefined;
  return err({
    code: "data.migration_failed",
    domain: "database",
    message: runResult.message,
    retryable: true,
    userActionable: false,
    redacted: true,
    correlationId,
    ...(details !== undefined ? { details } : {}),
  });
}

export function registerDatabaseHandlers(): Array<() => void> {
  const teardowns: Array<() => void> = [];

  // Single-flight dedup. Migrate has no input variation so a simple
  // promise reference is enough — joiners share the same in-flight run.
  // Cleared in `finally` for both success AND failure so Retry after a
  // failed attempt creates a fresh run (codex turn 1 answer B).
  let migrateInFlight: Promise<MigrateRunResult> | null = null;

  teardowns.push(
    registerHandler({
      channel: CH.database.migrate,
      domain: "database",
      inputSchema: migrateInputSchema,
      outputSchema: migrateResultSchema,
      handle: async (_input, ctx): Promise<Result<MigrateResult>> => {
        let run: Promise<MigrateRunResult>;
        if (migrateInFlight !== null) {
          log.info(
            `[ipc:vex:database:migrate] joining in-flight invocation correlationId=${ctx.requestId}`
          );
          // Replay the latest progress event directly to THIS renderer.
          // The broadcast subscriber only forwards FUTURE bus events;
          // a late-joining caller would otherwise miss the planned /
          // index / total handshake the in-flight run already emitted
          // (codex turn 2 should-fix #4).
          const lastProgress = migrationProgressBus.peek();
          if (lastProgress !== null && !ctx.event.sender.isDestroyed()) {
            ctx.event.sender.send(PROGRESS_CHANNEL, lastProgress);
          }
          run = migrateInFlight;
        } else {
          log.info(
            `[ipc:vex:database:migrate] starting correlationId=${ctx.requestId}`
          );
          run = runMigrationsForIpc();
          migrateInFlight = run;
        }

        try {
          const runResult = await run;
          return mapToResult(runResult, ctx.requestId);
        } finally {
          if (migrateInFlight === run) {
            migrateInFlight = null;
          }
        }
      },
    })
  );

  teardowns.push(broadcastMigrationProgress());

  return teardowns;
}
