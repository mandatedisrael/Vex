/**
 * Compose up/down lifecycle. Pre-flight port check + label-based reuse
 * detection (codex turn 4 YELLOW #6 — `docker ps --filter label=...`,
 * NOT `docker compose ls`). composeDown uses `stop`, never
 * `down --volumes` (skill §10).
 *
 * M11.5.4 — all `docker compose` invocations run with `cwd: composeDir`
 * and rely on Compose's auto-discovery of `docker-compose.yml`. The
 * `-f <path>` flag is intentionally never passed: under Docker Desktop
 * + WSL2 backend the absolute Windows path gets concatenated through
 * a bug class (`docker/compose#12669`, `#7101`) that resulted in the
 * silent `getServiceState` failure of the M11.5.3 attempt.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { runSpawn } from "../docker/spawn-runner.js";
import {
  isPortFree,
  parseComposeVersion,
  semverGte,
  COMPOSE_VERSION_FLOOR,
} from "../docker/probe.js";
import { ensureDockerDaemonReady } from "../docker/daemon.js";
import { inspectDockerEndpointPolicy } from "../docker/endpoint-policy.js";
import { DEFAULT_EMBED_PORT } from "../onboarding/embedding-defaults.js";
import { wizardStateStore } from "../onboarding/wizard-state-store.js";
import { SETUP_COMPLETE_FILE } from "../paths/config-dir.js";
import { pgConnectProbe } from "./pg-health.js";
import {
  waitForEmbeddingsRuntimeReady,
  type EmbeddingsReadinessKind,
} from "./embeddings-health.js";
import { renderCompose, type RenderDeps } from "./render.js";

const STALE_BIND_MOUNT_RE = /docker-desktop-bind-mounts.*no such file/i;

/**
 * Pre-flight that `docker compose` is at the inline-`configs.content:`
 * floor (`COMPOSE_VERSION_FLOOR`). Returning a non-null message means
 * we MUST abort `composeUp` — the template would otherwise error with
 * "unknown field: content" deep into the call. Codex turn 1 YELLOW —
 * use a real semver comparison so `v2.23.1-desktop.1` is accepted.
 */
async function checkComposeFloor(
  signal?: AbortSignal
): Promise<string | null> {
  const result = await runSpawn(
    "docker",
    ["compose", "version"],
    signal !== undefined ? { signal } : {}
  );
  if (result.code !== 0) {
    return "Docker Compose is not installed or not on PATH.";
  }
  const version = parseComposeVersion(result.stdout);
  if (!semverGte(version, COMPOSE_VERSION_FLOOR)) {
    return `Docker Compose ${
      version ?? "(unknown)"
    } is below the minimum supported version ${COMPOSE_VERSION_FLOOR}. Update Docker Desktop or the standalone compose plugin and retry.`;
  }
  return null;
}

interface ClearStaleSecretCacheResult {
  readonly wiped: boolean;
}

/**
 * Fail-safe "setup completed" gate (codex round 3 RED #1). Returns
 * true if ANY signal indicates the user finalized setup OR if the
 * state is unknown — only the explicit pre-setup combination
 * (wizard.completed===false AND no `.setup-complete` marker) permits
 * the destructive wipe path. `wizardState.completed` is the
 * authoritative source per `finalize.ts`; the marker file is
 * belt-and-suspenders.
 */
async function isSetupLikelyCompleted(): Promise<boolean> {
  let markerPresent = false;
  try {
    await fs.access(SETUP_COMPLETE_FILE);
    markerPresent = true;
  } catch {
    // marker absent — fall through to wizardState check
  }
  if (markerPresent) return true;
  // peekCompleted does NOT create defaults; null = unknown.
  const wizardCompleted = await wizardStateStore.peekCompleted();
  // Fail-safe: only the explicit `false` permits the wipe; null
  // (unknown / corrupt) is treated as "assume completed" so we never
  // destroy data when we cannot prove the operator is still in setup.
  return wizardCompleted !== false;
}

async function clearStaleSecretCache(
  deps: RenderDeps,
  outPath: string,
  installId: string,
  onLogLine?: (stream: "stdout" | "stderr", line: string) => void,
  signal?: AbortSignal
): Promise<ClearStaleSecretCacheResult> {
  // Codex review round 2 RED #1 + round 3 RED #1 — destructive
  // recovery gate. The original M5 logic tears the project down
  // INCLUDING its volumes (Postgres data, embeddings cache, knowledge
  // entries) because pre-M7 there was no user data worth preserving.
  // Post-setup we MUST refuse to wipe; the caller surfaces a
  // non-destructive manual recovery message instead of silently
  // destroying user state.
  if (await isSetupLikelyCompleted()) {
    onLogLine?.(
      "stderr",
      "[recovery] Stale bind-mount cache detected, but setup is already complete (or its status cannot be confirmed) — refusing to wipe user data."
    );
    return { wiped: false };
  }
  // Codex turn 14 RED #2 — destructive path must honour cancellation.
  // If the user cancelled before we enter the wipe stage, bail without
  // touching anything; the caller will surface internal.cancelled.
  if (signal?.aborted === true) {
    return { wiped: false };
  }

  // Pre-setup wipe is safe — no user-owned state yet. Regenerating the
  // password forces a new Docker bind-mount hash (so the stale-cache
  // symptom clears); the existing empty volume would otherwise still
  // hold `pg_authid` with the OLD password and authentication would
  // fail with `password authentication failed for user "vex"`.
  // `outPath` lives inside `composeDir`; pass `cwd` so Compose
  // auto-discovers `docker-compose.yml` instead of going through the
  // path-concatenation bugs in `docker/compose#12669` / `#7101`.
  await runSpawn(
    "docker",
    [
      "compose",
      "-p",
      `vex-${installId}`,
      "down",
      "--remove-orphans",
      "--volumes",
    ],
    {
      cwd: path.dirname(outPath),
      timeoutMs: 30_000,
      ...(signal !== undefined ? { signal } : {}),
      onStdoutLine: (line) => onLogLine?.("stdout", `[recovery] ${line}`),
      onStderrLine: (line) => onLogLine?.("stderr", `[recovery] ${line}`),
    }
  );
  // Bail BEFORE any file removal if the user cancelled while the
  // `compose down` subprocess was running. Removing the install-id /
  // secrets / compose tree is the destructive part — refusing here
  // keeps the on-disk state recoverable.
  if (signal?.aborted === true) {
    return { wiped: false };
  }
  // Reset all per-install state so the next render regenerates a fresh
  // install_id, password, and compose YAML. The new install_id yields
  // a brand-new volume namespace, and the new password hash forces
  // Docker Desktop to recompute its bind-mount cache.
  const installIdPath = path.join(deps.userDataDir, ".install-id");
  const secretsDir = path.join(deps.userDataDir, "local-infra", "secrets");
  const composeDir = path.join(deps.userDataDir, "compose");
  for (const target of [installIdPath, secretsDir, composeDir]) {
    if (signal?.aborted === true) {
      // Stop mid-loop — partial wipe is still safe (the next composeUp
      // run will detect the incomplete state and re-clear on retry).
      return { wiped: false };
    }
    try {
      await fs.rm(target, { recursive: true, force: true });
      onLogLine?.("stdout", `[recovery] Cleared ${target}`);
    } catch (err: unknown) {
      onLogLine?.(
        "stderr",
        `[recovery] Failed to clear ${target}: ${
          err instanceof Error ? err.message : "unknown"
        }`
      );
    }
  }
  return { wiped: true };
}

const DEFAULT_PG_PORT = 55432;
const HEALTH_POLL_INTERVAL_MS = 2_000;
const HEALTH_TIMEOUT_MS = 60_000;
const PULL_TIMEOUT_MS = 10 * 60_000;   // 10 min for first pull on slow networks
// First-run `up -d` triggers the init container's ~333 MB GGUF download
// from HuggingFace; on slow connections this can exceed the old 2 min
// budget. 15 min covers a 350 KB/s tail. Subsequent runs return in
// seconds (sha256-verified cache short-circuits the download).
const UP_TIMEOUT_MS = 15 * 60_000;

export type ComposeUpKind =
  | "running"
  | "reused"
  | "port_collision"
  | "unhealthy"
  | "failed";

export interface ComposeUpResult {
  readonly kind: ComposeUpKind;
  readonly composeOutPath: string;
  readonly installId: string;
  readonly message: string;
  /**
   * Port the published Postgres bound to on the loopback interface.
   * Always populated (even on failure paths) so the database handler
   * can derive a connection config without re-rendering compose.
   */
  readonly pgPort: number;
  /**
   * Port the published embeddings-runtime bound to. Always populated
   * for the same reason as `pgPort` — the wizard's auto-write defaults
   * step needs the published value, not a hardcoded constant.
   */
  readonly embedPort: number;
  /**
   * Absolute path to the secret file the compose stack mounts as
   * `/run/secrets/pg_password`. Same content (after read) is the
   * Postgres password. Main-process-internal — IPC handler MUST strip
   * before returning to renderer (the public schema is `.strict()`).
   */
  readonly pgPasswordPath: string;
  /**
   * Outcome of the host-side embeddings-runtime readiness probe.
   * `null` means the probe was not reached (failure earlier in the
   * pipeline). Surfaced for diagnostics; the renderer reads `kind`
   * primarily.
   */
  readonly embeddingsReadiness: EmbeddingsReadinessKind | null;
}

export type ComposeDownKind = "stopped" | "not_running" | "failed";

export interface ComposeDownResult {
  readonly kind: ComposeDownKind;
  readonly message: string;
}

export interface ComposeUpOptions {
  readonly pgPort?: number;
  readonly embedPort?: number;
  readonly signal?: AbortSignal;
  readonly onLogLine?: (stream: "stdout" | "stderr", line: string) => void;
}

async function isOurProjectActive(
  installId: string,
  signal?: AbortSignal
): Promise<boolean> {
  const project = `vex-${installId}`;
  // `docker ps --filter label=com.docker.compose.project=...` is the
  // skill-recommended detection (label survives daemon restarts; less
  // brittle than parsing `docker compose ls` JSON).
  const result = await runSpawn(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.docker.compose.project=${project}`,
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

async function waitForHealth(args: WaitForHealthArgs): Promise<boolean> {
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

export async function composeUp(
  deps: RenderDeps,
  options: ComposeUpOptions = {}
): Promise<ComposeUpResult> {
  const {
    signal,
    onLogLine,
    pgPort = DEFAULT_PG_PORT,
    embedPort = DEFAULT_EMBED_PORT,
  } = options;
  const renderOptions = { pgPort, embedPort };

  const endpoint = await inspectDockerEndpointPolicy(signal);
  if (!endpoint.accepted) {
    const rendered = await renderCompose(deps, renderOptions);
    return {
      kind: "failed",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: endpoint.message ?? "Docker endpoint policy rejected this request.",
      pgPort,
      embedPort: rendered.embedPort,
      pgPasswordPath: rendered.pgPasswordComposePath,
      embeddingsReadiness: null,
    };
  }

  // Compose-floor pre-check. Inline `configs.content:` is parsed only
  // by Compose ≥ 2.23.1; below that, `compose up` fails with a cryptic
  // "unknown field: content" error from the YAML loader. We surface a
  // direct upgrade hint instead.
  const floorErr = await checkComposeFloor(signal);
  if (floorErr !== null) {
    const rendered = await renderCompose(deps, renderOptions);
    return {
      kind: "failed",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: floorErr,
      pgPort,
      embedPort: rendered.embedPort,
      pgPasswordPath: rendered.pgPasswordComposePath,
      embeddingsReadiness: null,
    };
  }

  // Daemon preflight + auto-start. The user can have closed Docker
  // Desktop between System Check and ComposeBootstrap, so we re-probe
  // and (if needed) kick `performStart()` via the daemon helper.
  const daemon = await ensureDockerDaemonReady({
    signal,
    onStatus: (status) => onLogLine?.("stdout", status),
  });
  if (daemon.kind !== "ready" && daemon.kind !== "auto_started") {
    // Render so the renderer can display where the file would have landed,
    // even though we never made it to compose.
    const rendered = await renderCompose(deps, renderOptions);
    return {
      kind: "failed",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: `Docker daemon is not ready: ${daemon.message}`,
      pgPort,
      embedPort: rendered.embedPort,
      pgPasswordPath: rendered.pgPasswordComposePath,
      embeddingsReadiness: null,
    };
  }

  const rendered = await renderCompose(deps, renderOptions);
  const composeDir = path.dirname(rendered.outPath);

  // Pre-flight: are BOTH host ports free? Codex turn 1 RED #5 — we
  // never trusted the embed port preflight before, so a collision with
  // another LLM tool on 55134 would surface as the embeddings runtime
  // failing health rather than a clean port_collision message.
  const [pgFree, embedFree] = await Promise.all([
    isPortFree("127.0.0.1", pgPort, signal),
    isPortFree("127.0.0.1", rendered.embedPort, signal),
  ]);
  if (!pgFree || !embedFree) {
    const ourStack = await isOurProjectActive(rendered.installId, signal);
    if (ourStack) {
      // Re-run `compose up -d` against the existing project. Idempotent
      // when every service is already running; restarts any container
      // that previously exited (e.g. an `embeddings-model-init` that
      // hit a transient HF download error on the first try). Without
      // this kick, a partial stack from a prior failed up would trap
      // the user in an "unhealthy" loop with no path to recovery.
      onLogLine?.(
        "stdout",
        `Detected existing vex-${rendered.installId} stack — re-running compose up to converge service state…`
      );
      const reuseUp = await runSpawn("docker", ["compose", "up", "-d"], {
        cwd: composeDir,
        timeoutMs: UP_TIMEOUT_MS,
        ...(signal !== undefined ? { signal } : {}),
        onStdoutLine: (line) => onLogLine?.("stdout", line),
        onStderrLine: (line) => onLogLine?.("stderr", line),
      });
      // Failure here is non-fatal for the reuse path: we still try to
      // poll health and let the user see service-by-service what's
      // wrong. A hard `compose up` failure (e.g. init script still
      // failing post-fix) surfaces via the embeddings probe message.
      if (reuseUp.code !== 0 && !reuseUp.timedOut) {
        onLogLine?.(
          "stderr",
          `[reuse] compose up exited ${reuseUp.code ?? "?"}; falling through to health probes`
        );
      }

      const dbHealthy = await waitForHealth({
        pgPort,
        pgPasswordPath: rendered.pgPasswordComposePath,
        ...(signal !== undefined ? { signal } : {}),
        ...(onLogLine !== undefined ? { onLogLine } : {}),
      });
      const embedReady = dbHealthy
        ? await waitForEmbeddingsRuntimeReady({
            embedPort: rendered.embedPort,
            ...(signal !== undefined ? { signal } : {}),
            ...(onLogLine !== undefined ? { onLogLine } : {}),
          })
        : null;
      const reusable = dbHealthy && embedReady?.kind === "ready";
      return {
        kind: reusable ? "reused" : "unhealthy",
        composeOutPath: rendered.outPath,
        installId: rendered.installId,
        message: reusable
          ? `Reusing existing vex-${rendered.installId} compose project (pg :${pgPort}, embeddings :${rendered.embedPort}).`
          : `Existing vex stack found but a service is not yet healthy. ${
              embedReady?.message ??
              "Postgres did not accept a connection in time."
            }`,
        pgPort,
        embedPort: rendered.embedPort,
        pgPasswordPath: rendered.pgPasswordComposePath,
        embeddingsReadiness: embedReady?.kind ?? null,
      };
    }
    const conflicts: string[] = [];
    const occupiedPorts: number[] = [];
    if (!pgFree) {
      conflicts.push(`Postgres port ${pgPort}`);
      occupiedPorts.push(pgPort);
    }
    if (!embedFree) {
      conflicts.push(`embeddings port ${rendered.embedPort}`);
      occupiedPorts.push(rendered.embedPort);
    }
    // Codex review round 2 YELLOW #5 + round 3 YELLOW — keep the
    // message honest (Settings → Advanced does not expose embedPort)
    // AND specific about which port(s) are actually conflicting.
    const lsofExample = occupiedPorts.map((p) => `-i :${p}`).join(" ");
    return {
      kind: "port_collision",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: `${conflicts.join(
        " and "
      )} occupied by a different process. Stop the conflicting service (e.g. \`docker ps\`, \`lsof ${lsofExample}\`) and retry.`,
      pgPort,
      embedPort: rendered.embedPort,
      pgPasswordPath: rendered.pgPasswordComposePath,
      embeddingsReadiness: null,
    };
  }

  // Pull every image up-front. Implicit pull inside `up -d` blocks
  // without progress; `compose pull` lets us bound the call and stream
  // pull progress to the renderer log buffer. Pulls all services so
  // the embeddings stack's two images (llama.cpp:server + curlimages)
  // surface progress here too.
  onLogLine?.(
    "stdout",
    "Pulling images (first run can take several minutes)…"
  );
  const pullResult = await runSpawn("docker", ["compose", "pull"], {
    cwd: composeDir,
    timeoutMs: PULL_TIMEOUT_MS,
    ...(signal !== undefined ? { signal } : {}),
    onStdoutLine: (line) => onLogLine?.("stdout", line),
    onStderrLine: (line) => onLogLine?.("stderr", line),
  });
  if (pullResult.timedOut) {
    return {
      kind: "failed",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: `Image pull timed out after ${
        PULL_TIMEOUT_MS / 60_000
      } min. Check your network or retry.`,
      pgPort,
      embedPort: rendered.embedPort,
      pgPasswordPath: rendered.pgPasswordComposePath,
      embeddingsReadiness: null,
    };
  }
  if (pullResult.code !== 0) {
    return {
      kind: "failed",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: `\`docker compose pull\` exited with ${
        pullResult.code ?? "unknown"
      }: ${pullResult.stderr.split("\n").slice(-3).join(" ")}`,
      pgPort,
      embedPort: rendered.embedPort,
      pgPasswordPath: rendered.pgPasswordComposePath,
      embeddingsReadiness: null,
    };
  }

  onLogLine?.(
    "stdout",
    "Starting Vex stack (first run downloads the embeddings model, ~333 MB)…"
  );
  let upResult = await runSpawn("docker", ["compose", "up", "-d"], {
    cwd: composeDir,
    timeoutMs: UP_TIMEOUT_MS,
    ...(signal !== undefined ? { signal } : {}),
    onStdoutLine: (line) => onLogLine?.("stdout", line),
    onStderrLine: (line) => onLogLine?.("stderr", line),
  });

  // Detect Docker Desktop's stale bind-mount cache failure. After a
  // Docker Desktop restart the cache directory under
  // `/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/<distro>/<hash>`
  // is wiped; the daemon still references the old hash, mount fails with
  // "no such file or directory". Recovery: tear the project down,
  // regenerate the password file (new content → new bind-mount hash),
  // re-render the compose, and retry up-d ONCE.
  let renderedAfterRecovery = rendered;
  let composeDirAfterRecovery = composeDir;
  if (
    upResult.code !== 0 &&
    !upResult.timedOut &&
    STALE_BIND_MOUNT_RE.test(upResult.stderr)
  ) {
    onLogLine?.(
      "stdout",
      "[recovery] Detected stale Docker Desktop bind-mount cache; refreshing secret + retrying…"
    );
    const cleared = await clearStaleSecretCache(
      deps,
      rendered.outPath,
      rendered.installId,
      onLogLine,
      signal
    );
    if (!cleared.wiped) {
      // Setup gate refused — return failure WITHOUT destructive
      // instructions (codex round 3 RED #2). Telling the user to
      // delete `local-infra/secrets/` would regenerate the Postgres
      // password while the existing volume still holds the OLD
      // password — `password authentication failed for user "vex"`
      // locks them out of their own data. Recovery here is
      // support-guided.
      return {
        kind: "failed",
        composeOutPath: rendered.outPath,
        installId: rendered.installId,
        message:
          "Docker Desktop has a stale bind-mount cache pointing at this install's Postgres password secret, and your setup is already complete. Vex will NOT auto-wipe your data. Try fully quitting Docker Desktop and restarting it, then retry — if the issue persists, contact support before any further action so we can guide you through a recovery that preserves your wallet keys and knowledge entries.",
        pgPort,
        embedPort: rendered.embedPort,
        pgPasswordPath: rendered.pgPasswordComposePath,
        embeddingsReadiness: null,
      };
    }
    renderedAfterRecovery = await renderCompose(deps, renderOptions);
    composeDirAfterRecovery = path.dirname(renderedAfterRecovery.outPath);
    upResult = await runSpawn("docker", ["compose", "up", "-d"], {
      cwd: composeDirAfterRecovery,
      timeoutMs: UP_TIMEOUT_MS,
      ...(signal !== undefined ? { signal } : {}),
      onStdoutLine: (line) => onLogLine?.("stdout", line),
      onStderrLine: (line) => onLogLine?.("stderr", line),
    });
  }

  if (upResult.timedOut) {
    return {
      kind: "failed",
      composeOutPath: renderedAfterRecovery.outPath,
      installId: renderedAfterRecovery.installId,
      message: `\`docker compose up -d\` timed out after ${
        UP_TIMEOUT_MS / 60_000
      } min.`,
      pgPort,
      embedPort: renderedAfterRecovery.embedPort,
      pgPasswordPath: renderedAfterRecovery.pgPasswordComposePath,
      embeddingsReadiness: null,
    };
  }
  if (upResult.code !== 0) {
    return {
      kind: "failed",
      composeOutPath: renderedAfterRecovery.outPath,
      installId: renderedAfterRecovery.installId,
      message: `\`docker compose up -d\` exited with ${
        upResult.code ?? "unknown"
      }: ${upResult.stderr.split("\n").slice(-3).join(" ")}`,
      pgPort,
      embedPort: renderedAfterRecovery.embedPort,
      pgPasswordPath: renderedAfterRecovery.pgPasswordComposePath,
      embeddingsReadiness: null,
    };
  }

  onLogLine?.("stdout", "Waiting for Postgres to accept connections…");
  const dbHealthy = await waitForHealth({
    pgPort,
    pgPasswordPath: renderedAfterRecovery.pgPasswordComposePath,
    ...(signal !== undefined ? { signal } : {}),
    ...(onLogLine !== undefined ? { onLogLine } : {}),
  });
  if (!dbHealthy) {
    return {
      kind: "unhealthy",
      composeOutPath: renderedAfterRecovery.outPath,
      installId: renderedAfterRecovery.installId,
      message: `Stack started but Postgres did not accept a TCP connection within ${
        HEALTH_TIMEOUT_MS / 1000
      }s.`,
      pgPort,
      embedPort: renderedAfterRecovery.embedPort,
      pgPasswordPath: renderedAfterRecovery.pgPasswordComposePath,
      embeddingsReadiness: null,
    };
  }

  onLogLine?.(
    "stdout",
    "Postgres ready. Probing embeddings runtime (cold start includes model load)…"
  );
  const embedReady = await waitForEmbeddingsRuntimeReady({
    embedPort: renderedAfterRecovery.embedPort,
    ...(signal !== undefined ? { signal } : {}),
    ...(onLogLine !== undefined ? { onLogLine } : {}),
  });
  if (embedReady.kind !== "ready") {
    return {
      kind: "unhealthy",
      composeOutPath: renderedAfterRecovery.outPath,
      installId: renderedAfterRecovery.installId,
      message: embedReady.message,
      pgPort,
      embedPort: renderedAfterRecovery.embedPort,
      pgPasswordPath: renderedAfterRecovery.pgPasswordComposePath,
      embeddingsReadiness: embedReady.kind,
    };
  }

  return {
    kind: "running",
    composeOutPath: renderedAfterRecovery.outPath,
    installId: renderedAfterRecovery.installId,
    message: `Vex stack vex-${renderedAfterRecovery.installId} is running (pg :${pgPort}, embeddings :${renderedAfterRecovery.embedPort}, dim=${embedReady.observedDim}).`,
    pgPort,
    embedPort: renderedAfterRecovery.embedPort,
    pgPasswordPath: renderedAfterRecovery.pgPasswordComposePath,
    embeddingsReadiness: "ready",
  };
}

export async function composeDown(
  composeOutPath: string,
  installId: string,
  signal?: AbortSignal
): Promise<ComposeDownResult> {
  const project = `vex-${installId}`;
  const composeDir = path.dirname(composeOutPath);
  const endpoint = await inspectDockerEndpointPolicy(signal);
  if (!endpoint.accepted) {
    return {
      kind: "failed",
      message: endpoint.message ?? "Docker endpoint policy rejected this request.",
    };
  }

  // Codex turn 1 RED #1 / R7 — drive compose via cwd so we never feed
  // a Windows absolute path through the buggy `-f` resolver. If the
  // compose dir vanished underneath us (uninstall path), fall back to
  // a label-based `docker stop` of the project's containers — that
  // path does not require a compose file at all.
  let dirExists = true;
  try {
    await fs.access(composeDir);
  } catch {
    dirExists = false;
  }

  // Codex review turn 2 YELLOW #6: `compose stop` may fail with a
  // "no compose file" error if the YAML disappeared while the dir
  // still exists. In that case, fall through to the label-based path
  // — it does not need a compose file.
  const COMPOSE_FILE_MISSING_RE =
    /no configuration file|no compose file|does not exist|compose\.ya?ml.*not found/i;
  if (dirExists) {
    const result = await runSpawn(
      "docker",
      ["compose", "-p", project, "stop"],
      {
        cwd: composeDir,
        ...(signal !== undefined ? { signal } : {}),
      }
    );
    if (result.code === 0) {
      return {
        kind: "stopped",
        message: `Stopped vex-${installId} compose project.`,
      };
    }
    if (/no such project|not found/i.test(result.stderr)) {
      return { kind: "not_running", message: "Project was not running." };
    }
    // YAML missing? Pretend dir is gone and try label fallback.
    if (!COMPOSE_FILE_MISSING_RE.test(result.stderr)) {
      return {
        kind: "failed",
        message: `\`docker compose stop\` exited with ${
          result.code ?? "unknown"
        }: ${result.stderr.split("\n").slice(-3).join(" ")}`,
      };
    }
  }

  // Compose dir gone OR YAML missing — list running containers via
  // the project label and stop them directly via the engine. `-a`
  // would include exited init containers; we filter to `status=running`
  // because `docker stop` errors on already-exited containers.
  const list = await runSpawn(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--filter",
      "status=running",
      "--format",
      "{{.ID}}",
    ],
    signal !== undefined ? { signal } : {}
  );
  // Codex review turn 2 YELLOW #6: distinguish a docker ps failure
  // (engine down, permission denied) from "ps succeeded but no
  // containers matched the label". The former MUST be a failure
  // result; the latter is genuinely "not running".
  if (list.code !== 0) {
    return {
      kind: "failed",
      message: `\`docker ps\` exited with ${
        list.code ?? "unknown"
      } while looking for vex-${installId} containers: ${list.stderr
        .split("\n")
        .slice(-3)
        .join(" ")}`,
    };
  }
  const ids = list.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) {
    return {
      kind: "not_running",
      message:
        "No running containers carry the project label; nothing to stop.",
    };
  }
  const stopResult = await runSpawn(
    "docker",
    ["stop", ...ids],
    signal !== undefined ? { signal } : {}
  );
  if (stopResult.code === 0) {
    return {
      kind: "stopped",
      message: `Stopped ${ids.length} container(s) for vex-${installId} via label fallback.`,
    };
  }
  return {
    kind: "failed",
    message: `Label-based stop exited with ${
      stopResult.code ?? "unknown"
    }: ${stopResult.stderr.split("\n").slice(-3).join(" ")}`,
  };
}
