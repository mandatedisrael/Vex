/**
 * Async Docker probe runner. Replaces `spawnSync`-based engine helpers
 * (which would freeze Electron's main process — codex turn 3 RED #2)
 * with `execFile` + `AbortController` + per-probe timeout. Pure parsers
 * are unit-testable on string fixtures so we never need Docker installed
 * to run the test suite.
 *
 * This module is a compatibility façade: the implementation now lives in
 * the `./probe/` subdirectory, split by concern (parsers, version,
 * ports, disk, daemon). The public surface is re-exported verbatim so
 * existing importers (`compose/preflight.ts`, `ipc/docker.ts`) keep
 * resolving unchanged.
 */

export {
  parseDockerVersion,
  parseComposeVersion,
  parseModelStatus,
  parseDaemonRunning,
} from "./probe/parsers.js";
export type { ModelStatusKind } from "./probe/parsers.js";

export {
  COMPOSE_VERSION_FLOOR,
  parseSemver,
  semverGte,
} from "./probe/version.js";
export type { ParsedSemver } from "./probe/version.js";

export {
  isPortFree,
  isModelRunnerEndpointReachable,
} from "./probe/ports.js";

export { getAvailableDiskGB } from "./probe/disk.js";

export { probeDocker } from "./probe/daemon.js";
export type { DockerProbeOpts } from "./probe/daemon.js";
