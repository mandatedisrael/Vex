/**
 * Service health: label-based project liveness detection + Postgres
 * health polling. `isOurProjectActive` powers the reuse path;
 * `waitForHealth` polls `pgConnectProbe` until the published Postgres
 * accepts a connection or the budget expires.
 */

import { runSpawn } from "../docker/spawn-runner.js";
import { pgConnectProbe } from "./pg-health.js";
import { projectLabelFilter } from "./project.js";

export const HEALTH_POLL_INTERVAL_MS = 2_000;
export const HEALTH_TIMEOUT_MS = 60_000;

export async function isOurProjectActive(
  installId: string,
  signal?: AbortSignal
): Promise<boolean> {
  // `docker ps --filter label=com.docker.compose.project=...` is the
  // skill-recommended detection (label survives daemon restarts; less
  // brittle than parsing `docker compose ls` JSON).
  const result = await runSpawn(
    "docker",
    [
      "ps",
      "--filter",
      projectLabelFilter(installId),
      "--format",
      "{{.ID}}",
    ],
    { signal }
  );
  if (result.code !== 0) return false;
  return result.stdout.trim().length > 0;
}

interface HealthProbeArgs {
  readonly pgPort: number;
  readonly pgPasswordPath: string;
  readonly attempt: number;
  readonly signal?: AbortSignal;
  readonly onLogLine?: (stream: "stdout" | "stderr", line: string) => void;
}

async function probeDbHealth(args: HealthProbeArgs): Promise<boolean> {
  args.onLogLine?.(
    "stdout",
    `Postgres health probe #${args.attempt}: connecting on 127.0.0.1:${args.pgPort}…`
  );
  const result = await pgConnectProbe({
    host: "127.0.0.1",
    port: args.pgPort,
    database: "vex",
    user: "vex",
    pgPasswordPath: args.pgPasswordPath,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  });
  if (result.ok) {
    args.onLogLine?.("stdout", `Postgres health probe #${args.attempt}: ready.`);
    return true;
  }
  args.onLogLine?.(
    "stderr",
    `Postgres health probe #${args.attempt}: ${result.message}`
  );
  return false;
}

interface WaitForHealthArgs {
  readonly pgPort: number;
  readonly pgPasswordPath: string;
  readonly signal?: AbortSignal;
  readonly onLogLine?: (stream: "stdout" | "stderr", line: string) => void;
}

export async function waitForHealth(args: WaitForHealthArgs): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (args.signal?.aborted) return false;
    attempt += 1;
    if (
      await probeDbHealth({
        pgPort: args.pgPort,
        pgPasswordPath: args.pgPasswordPath,
        attempt,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
        ...(args.onLogLine !== undefined ? { onLogLine: args.onLogLine } : {}),
      })
    ) {
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}
