/**
 * vex.docker.* — Docker subsystem detection (M2 surface).
 *
 * `detect()` runs the async probe runner in `../docker/probe.ts`. M4 will
 * expand this domain with `install`, `start`, `composeUp`, `composeDown`
 * + domain-namespaced event subscriptions; for M2 we only ship detection.
 */

import { z } from "zod";
import { CH, EV } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  composeDownResultSchema,
  composeUpResultSchema,
  dockerStatusSchema,
  installMethodSchema,
  installResultSchema,
  startResultSchema,
  type ComposeDownResult,
  type ComposeUpResult,
  type DockerStatus,
  type InstallResult,
  type StartResult,
} from "@shared/schemas/docker.js";
import { probeDocker } from "../docker/probe.js";
import { performInstall } from "../docker/install.js";
import { performStart } from "../docker/start.js";
import { composeLogBus, dockerProgressBus } from "../docker/progress-bus.js";
import {
  composeDown,
  composeUp,
  type ComposeUpResult as InternalComposeUpResult,
} from "../compose/lifecycle.js";
import { buildRenderDeps } from "../compose/deps-factory.js";
import { log } from "../logger/index.js";
import { CONFIG_DIR } from "../paths/config-dir.js";
import { setDbConnection } from "../database/connection-state.js";
import { broadcastToAllWindows } from "../lifecycle/broadcast.js";
import { registerHandler } from "./register-handler.js";

const empty = z.object({}).strict();
const installInputSchema = z
  .object({ method: installMethodSchema })
  .strict();
const composeUpInputSchema = z
  .object({ pgPort: z.number().int().min(1).max(65535).optional() })
  .strict();

const DEFAULT_PG_PORT = 55432;
const DEFAULT_MODEL_RUNNER_BASE_URL = "http://127.0.0.1:12434/engines/llama.cpp/v1";

function broadcastProgress(): () => void {
  return dockerProgressBus.subscribe((payload) =>
    broadcastToAllWindows(EV.docker.installProgress, payload)
  );
}

function broadcastComposeLogs(): () => void {
  return composeLogBus.subscribe((payload) =>
    broadcastToAllWindows(EV.docker.composeLogs, payload)
  );
}

export function registerDockerHandlers(): Array<() => void> {
  const teardowns: Array<() => void> = [];

  teardowns.push(
    registerHandler({
      channel: CH.docker.detect,
      domain: "docker",
      inputSchema: empty,
      outputSchema: dockerStatusSchema,
      handle: async (): Promise<Result<DockerStatus>> => {
        const status = await probeDocker({
          pgPort: DEFAULT_PG_PORT,
          modelRunnerBaseUrl: DEFAULT_MODEL_RUNNER_BASE_URL,
          diskTarget: CONFIG_DIR,
        });
        return ok(status);
      },
    })
  );

  teardowns.push(
    registerHandler({
      channel: CH.docker.install,
      domain: "docker",
      inputSchema: installInputSchema,
      outputSchema: installResultSchema,
      handle: async (input): Promise<Result<InstallResult>> => {
        const result = await performInstall(input.method);
        return ok(result);
      },
    })
  );

  teardowns.push(
    registerHandler({
      channel: CH.docker.start,
      domain: "docker",
      inputSchema: empty,
      outputSchema: startResultSchema,
      handle: async (): Promise<Result<StartResult>> => {
        const result = await performStart();
        return ok(result);
      },
    })
  );

  let lastComposeOutPath: string | null = null;
  let lastInstallId: string | null = null;

  // Single-flight deduplication for composeUp. React StrictMode dev
  // double-mount + HMR can fire `vex.docker.composeUp` twice in quick
  // succession; without dedup the second invocation runs concurrently
  // and stays `isPending` long after the first emitted "ready",
  // freezing the renderer mutation hook (codex turn 8 diagnosis).
  let composeUpInFlight: Promise<InternalComposeUpResult> | null = null;
  let composeUpInFlightKey: string | null = null;

  // Idempotent finalize: persist main-only side-effects (last paths, DB
  // connection) and strip pgPort/pgPasswordPath so the payload survives
  // composeUpResultSchema's `.strict()` validation. Called from BOTH
  // the fresh path AND the joined single-flight path — the latter
  // previously returned the un-stripped internal result, regressing
  // the StrictMode dedup fix to `internal.contract_violation`
  // (codex turn 2 must-fix #1).
  function finalizeAndShape(
    internal: InternalComposeUpResult
  ): ComposeUpResult {
    lastComposeOutPath = internal.composeOutPath;
    lastInstallId = internal.installId;
    // Persist DB connection only when the stack is actually usable.
    // Failure paths still carry pgPort/pgPasswordPath but consumers
    // (the migration runner) must NOT see a connection that points
    // at a degraded stack.
    if (internal.kind === "running" || internal.kind === "reused") {
      setDbConnection({
        pgPort: internal.pgPort,
        pgPasswordPath: internal.pgPasswordPath,
      });
    }
    const {
      pgPort: _pgPort,
      pgPasswordPath: _pgPasswordPath,
      ...publicResult
    } = internal;
    return publicResult;
  }

  teardowns.push(
    registerHandler({
      channel: CH.docker.composeUp,
      domain: "docker",
      inputSchema: composeUpInputSchema,
      outputSchema: composeUpResultSchema,
      handle: async (input): Promise<Result<ComposeUpResult>> => {
        const key = `pgPort=${input.pgPort ?? "default"}`;
        if (composeUpInFlight !== null && composeUpInFlightKey === key) {
          log.info(
            `[ipc:vex:docker:composeUp] joining in-flight invocation (key=${key})`
          );
          const reused = await composeUpInFlight;
          return ok(finalizeAndShape(reused));
        }

        log.info(
          `[ipc:vex:docker:composeUp] starting (key=${key})`
        );
        const startedAt = Date.now();
        const deps = buildRenderDeps();
        const run = composeUp(deps, {
          ...(input.pgPort !== undefined ? { pgPort: input.pgPort } : {}),
          onLogLine: (stream, line) =>
            composeLogBus.emit({ stream, line, ts: Date.now() }),
        });
        composeUpInFlight = run;
        composeUpInFlightKey = key;
        try {
          const result = await run;
          log.info(
            `[ipc:vex:docker:composeUp] completed kind=${result.kind} elapsed=${Date.now() - startedAt}ms`
          );
          // The "completed" log emit lives ONLY on the fresh path so
          // joined callers don't double-log the same outcome.
          composeLogBus.emit({
            stream:
              result.kind === "running" || result.kind === "reused"
                ? "stdout"
                : "stderr",
            line: `Compose bootstrap completed: ${result.kind}.`,
            ts: Date.now(),
          });
          return ok(finalizeAndShape(result));
        } finally {
          if (composeUpInFlight === run) {
            composeUpInFlight = null;
            composeUpInFlightKey = null;
          }
        }
      },
    })
  );

  teardowns.push(
    registerHandler({
      channel: CH.docker.composeDown,
      domain: "docker",
      inputSchema: empty,
      outputSchema: composeDownResultSchema,
      handle: async (): Promise<Result<ComposeDownResult>> => {
        if (!lastComposeOutPath || !lastInstallId) {
          return ok({
            kind: "not_running",
            message: "No compose project has been started in this session.",
          });
        }
        const result = await composeDown(lastComposeOutPath, lastInstallId);
        // Clear the DB connection handoff only on a confirmed stop —
        // a failed down may have left the stack running with the same
        // credentials, so we keep the state so the migration runner
        // can still talk to it (codex turn 2 should-fix on lifecycle
        // hygiene). `not_running` is short-circuited above.
        if (result.kind === "stopped") {
          setDbConnection(null);
        }
        return ok(result);
      },
    })
  );

  // Subscribe the progress + compose log buses to all renderers — runs
  // for the lifetime of the main process, torn down when handlers are
  // removed.
  teardowns.push(broadcastProgress());
  teardowns.push(broadcastComposeLogs());

  return teardowns;
}
