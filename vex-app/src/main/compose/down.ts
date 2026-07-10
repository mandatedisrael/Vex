/**
 * `compose stop` + label-based fallback internals for composeDown. The
 * primary path drives compose via `cwd` (M11.5.4 — never `-f`). If the
 * compose dir/YAML vanished underneath us (uninstall path), the caller
 * falls back to a label-based `docker ps` + `docker stop` that needs no
 * compose file at all.
 */

import { runSpawn, type SpawnRunnerResult } from "../docker/spawn-runner.js";
import { composeArgs, projectName, projectLabelFilter } from "./project.js";

export interface DockerContainerCommandOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface AllRunningComposeProjectsQuery {
  readonly kind: "all-compose-projects";
}

function spawnOptions(
  input?: AbortSignal | DockerContainerCommandOptions,
): DockerContainerCommandOptions {
  if (input === undefined) return {};
  return input instanceof AbortSignal ? { signal: input } : input;
}

// Codex review turn 2 YELLOW #6: `compose stop` may fail with a
// "no compose file" error if the YAML disappeared while the dir
// still exists. In that case, fall through to the label-based path
// — it does not need a compose file.
export const COMPOSE_FILE_MISSING_RE =
  /no configuration file|no compose file|does not exist|compose\.ya?ml.*not found/i;

/**
 * `docker compose -p <project> stop` driven via `cwd: composeDir` so we
 * never feed a Windows absolute path through the buggy `-f` resolver.
 */
export async function composeStop(
  installId: string,
  composeDir: string,
  signal?: AbortSignal
): Promise<SpawnRunnerResult> {
  return runSpawn(
    "docker",
    composeArgs(["-p", projectName(installId), "stop"]),
    {
      cwd: composeDir,
      ...(signal !== undefined ? { signal } : {}),
    }
  );
}

/**
 * List the project's running container IDs via the compose project
 * label. `-a` would include exited init containers; we filter to
 * `status=running` because `docker stop` errors on already-exited
 * containers.
 */
export async function listRunningProjectContainers(
  installId: string,
  signal?: AbortSignal,
): Promise<SpawnRunnerResult>;
export async function listRunningProjectContainers(
  query: AllRunningComposeProjectsQuery,
  options?: DockerContainerCommandOptions,
): Promise<SpawnRunnerResult>;
export async function listRunningProjectContainers(
  installIdOrQuery: string | AllRunningComposeProjectsQuery,
  signalOrOptions?: AbortSignal | DockerContainerCommandOptions,
): Promise<SpawnRunnerResult> {
  const options = spawnOptions(signalOrOptions);
  if (typeof installIdOrQuery !== "string") {
    return runSpawn(
      "docker",
      [
        "ps",
        "--no-trunc",
        "--filter",
        "status=running",
        "--format",
        '{{.ID}}\t{{.Label "com.docker.compose.project"}}',
      ],
      options,
    );
  }
  return runSpawn(
    "docker",
    [
      "ps",
      "--filter",
      projectLabelFilter(installIdOrQuery),
      "--filter",
      "status=running",
      "--format",
      "{{.ID}}",
    ],
    options,
  );
}

/**
 * `docker stop <id…>` for the label-fallback path.
 */
export async function stopContainers(
  ids: readonly string[],
  signalOrOptions?: AbortSignal | DockerContainerCommandOptions,
): Promise<SpawnRunnerResult> {
  return runSpawn(
    "docker",
    ["stop", ...ids],
    spawnOptions(signalOrOptions),
  );
}
