/**
 * Surface guard for the `probe.ts` compatibility façade. Asserts that the
 * façade-preserving split keeps the exact public runtime export-key set
 * and each export's `typeof`, and that the exported types still compile
 * via type-only imports. No Docker required — this is a pure shape check.
 */

import { describe, expect, it } from "vitest";
import * as probe from "../probe.js";

// Type-only imports must compile (erased at runtime).
import type {
  ParsedSemver,
  ModelStatusKind,
  DockerProbeOpts,
} from "../probe.js";

describe("probe.ts façade surface", () => {
  it("exposes the exact runtime export-key set", () => {
    expect(Object.keys(probe).sort()).toEqual(
      [
        "COMPOSE_VERSION_FLOOR",
        "getAvailableDiskGB",
        "isModelRunnerEndpointReachable",
        "isPortFree",
        "parseComposeVersion",
        "parseDaemonRunning",
        "parseDockerVersion",
        "parseModelStatus",
        "parseSemver",
        "probeDocker",
        "semverGte",
      ].sort()
    );
  });

  it("preserves the typeof of each runtime export", () => {
    expect(typeof probe.parseDockerVersion).toBe("function");
    expect(typeof probe.parseComposeVersion).toBe("function");
    expect(typeof probe.parseModelStatus).toBe("function");
    expect(typeof probe.parseDaemonRunning).toBe("function");
    expect(typeof probe.parseSemver).toBe("function");
    expect(typeof probe.semverGte).toBe("function");
    expect(typeof probe.isPortFree).toBe("function");
    expect(typeof probe.isModelRunnerEndpointReachable).toBe("function");
    expect(typeof probe.getAvailableDiskGB).toBe("function");
    expect(typeof probe.probeDocker).toBe("function");
    expect(typeof probe.COMPOSE_VERSION_FLOOR).toBe("string");
  });

  it("keeps COMPOSE_VERSION_FLOOR value unchanged", () => {
    expect(probe.COMPOSE_VERSION_FLOOR).toBe("2.23.1");
  });

  it("compiles type-only imports of exported types", () => {
    const semver: ParsedSemver = { major: 2, minor: 23, patch: 1 };
    const status: ModelStatusKind = "active";
    const opts: DockerProbeOpts = { pgPort: 5432, diskTarget: "/" };
    expect(semver.major).toBe(2);
    expect(status).toBe("active");
    expect(opts.pgPort).toBe(5432);
  });
});
