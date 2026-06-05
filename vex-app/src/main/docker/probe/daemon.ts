/**
 * Async Docker probe runner. Replaces `spawnSync`-based engine helpers
 * (which would freeze Electron's main process — codex turn 3 RED #2)
 * with `execFile` + `AbortController` + per-probe timeout. Pure parsers
 * are unit-testable on string fixtures so we never need Docker installed
 * to run the test suite.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  parseDockerVersion,
  parseComposeVersion,
  parseModelStatus,
  parseDaemonRunning,
  type ModelStatusKind,
} from "./parsers.js";
import { isPortFree, isModelRunnerEndpointReachable } from "./ports.js";
import { getAvailableDiskGB } from "./disk.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_BUFFER = 1024 * 1024;

interface RunResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorMessage: string | null;
}

async function runCmd(
  cmd: string,
  args: ReadonlyArray<string>,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<RunResult> {
  const ac = new AbortController();
  const linkedAbort = (): void => ac.abort();
  signal?.addEventListener("abort", linkedAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const { stdout, stderr } = await execFileAsync(cmd, [...args], {
      signal: ac.signal,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return { ok: true, stdout, stderr, errorMessage: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stdout =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout: unknown }).stdout ?? "")
        : "";
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr ?? "")
        : "";
    return { ok: false, stdout, stderr, errorMessage: message };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", linkedAbort);
  }
}

// ── Composite probe ──────────────────────────────────────────────────

import type { DockerStatus } from "@shared/schemas/docker.js";
import { inspectDockerEndpointPolicy } from "../endpoint-policy.js";

export interface DockerProbeOpts {
  readonly signal?: AbortSignal;
  readonly pgPort: number;
  readonly modelRunnerBaseUrl?: string;
  readonly diskTarget: string;
}

export async function probeDocker(opts: DockerProbeOpts): Promise<DockerStatus> {
  const { signal, pgPort, modelRunnerBaseUrl, diskTarget } = opts;

  const [versionRes, composeRes, endpoint, pgFree, diskGB] =
    await Promise.all([
      runCmd("docker", ["--version"], signal),
      runCmd("docker", ["compose", "version"], signal),
      inspectDockerEndpointPolicy(signal),
      isPortFree("127.0.0.1", pgPort, signal),
      getAvailableDiskGB(diskTarget),
    ]);

  const engineVersion = versionRes.ok ? parseDockerVersion(versionRes.stdout) : null;
  const composeVersion = composeRes.ok ? parseComposeVersion(composeRes.stdout) : null;
  let modelStatus: ModelStatusKind = "unsupported";
  let daemonRunning = false;
  let mrTcp = false;

  if (versionRes.ok && endpoint.accepted) {
    const [modelRes, infoRes, modelRunnerTcp] = await Promise.all([
      runCmd("docker", ["model", "status"], signal),
      runCmd("docker", ["info", "--format", "{{json .}}"], signal),
      isModelRunnerEndpointReachable(modelRunnerBaseUrl, signal),
    ]);
    modelStatus = parseModelStatus(modelRes.stdout, modelRes.errorMessage);
    daemonRunning = parseDaemonRunning(infoRes.stdout, infoRes.errorMessage);
    mrTcp = modelRunnerTcp;
  }

  return {
    endpoint,
    engine: {
      present: versionRes.ok,
      version: engineVersion,
      runtimeOK: versionRes.ok && endpoint.accepted && daemonRunning,
    },
    compose: {
      present: composeRes.ok,
      version: composeVersion,
    },
    modelRunner: {
      present: modelStatus !== "unsupported",
      status: modelStatus,
      tcpReachable: mrTcp,
    },
    daemon: {
      running: daemonRunning,
      // Startable means Vex can attempt a non-privileged start. Linux Docker
      // Engine may still require user/admin action outside Vex.
      startable: versionRes.ok,
    },
    ports: {
      vexPgFree: pgFree,
    },
    disk: {
      availableGB: diskGB,
    },
  };
}
