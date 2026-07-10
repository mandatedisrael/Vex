import { z } from "zod";

import { runSpawn } from "../docker/spawn-runner.js";
import {
  listRunningProjectContainers,
  stopContainers,
} from "./down.js";
import { projectName } from "./project.js";

export const ORPHAN_STACKS_TIMEOUT_MS = 15_000;
export const ORPHAN_STACKS_STOP_TIMEOUT_MS = 45_000;

const VEX_UUID_PROJECT_RE =
  /^vex-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FULL_CONTAINER_ID_RE = /^[0-9a-f]{64}$/i;

const portBindingSchema = z
  .object({
    HostIp: z.string(),
    HostPort: z.string().regex(/^\d{1,5}$/),
  })
  .strict();
const publishedPortsSchema = z.record(
  z.string(),
  z.array(portBindingSchema).nullable(),
);

export interface PreviousInstallCandidate {
  readonly containerId: string;
  readonly project: string;
}

export interface FindPreviousInstallContainersOptions {
  readonly currentInstallId: string;
  readonly conflictPorts: ReadonlyArray<number>;
  readonly signal?: AbortSignal;
}

export type PreviousInstallContainersResult =
  | { readonly ok: true; readonly containerIds: ReadonlyArray<string> }
  | {
      readonly ok: false;
      readonly containerIds: readonly [];
      readonly message: string;
    };

export type StopStacksHoldingPortsResult =
  | {
      readonly ok: true;
      readonly stoppedCount: number;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly stoppedCount: 0;
      readonly message: string;
    };

export function parsePreviousInstallCandidates(
  stdout: string,
  currentInstallId: string,
): ReadonlyArray<PreviousInstallCandidate> {
  const currentProject = projectName(currentInstallId).toLowerCase();
  const candidates = new Map<string, PreviousInstallCandidate>();
  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length !== 2) continue;
    const containerId = parts[0]?.trim() ?? "";
    const project = parts[1]?.trim() ?? "";
    if (!FULL_CONTAINER_ID_RE.test(containerId)) continue;
    if (!VEX_UUID_PROJECT_RE.test(project)) continue;
    if (project.toLowerCase() === currentProject) continue;
    candidates.set(containerId, { containerId, project });
  }
  return [...candidates.values()];
}

export function parsePublishedHostPorts(
  stdout: string,
): ReadonlyArray<number> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return null;
  }
  const parsed = publishedPortsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const ports = new Set<number>();
  for (const bindings of Object.values(parsed.data)) {
    if (bindings === null) continue;
    for (const binding of bindings) {
      const port = Number(binding.HostPort);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        ports.add(port);
      }
    }
  }
  return [...ports];
}

export async function findPreviousInstallContainersHoldingPorts(
  options: FindPreviousInstallContainersOptions,
): Promise<PreviousInstallContainersResult> {
  const commandOptions = {
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    timeoutMs: ORPHAN_STACKS_TIMEOUT_MS,
  };
  const listed = await listRunningProjectContainers(
    { kind: "all-compose-projects" },
    commandOptions,
  );
  if (listed.code !== 0 || listed.timedOut || listed.aborted) {
    return {
      ok: false,
      containerIds: [],
      message: "Could not inspect running Docker containers.",
    };
  }

  const candidates = parsePreviousInstallCandidates(
    listed.stdout,
    options.currentInstallId,
  );
  const conflictPorts = new Set(options.conflictPorts);
  const matching: string[] = [];
  let inspectionFailed = false;
  for (const candidate of candidates) {
    const inspected = await runSpawn(
      "docker",
      [
        "inspect",
        "--format",
        "{{json .NetworkSettings.Ports}}",
        candidate.containerId,
      ],
      commandOptions,
    );
    if (inspected.timedOut || inspected.aborted) {
      return {
        ok: false,
        containerIds: [],
        message: "Docker container inspection did not complete.",
      };
    }
    if (inspected.code !== 0) {
      inspectionFailed = true;
      continue;
    }
    const publishedPorts = parsePublishedHostPorts(inspected.stdout);
    if (publishedPorts === null) {
      inspectionFailed = true;
      continue;
    }
    if (publishedPorts.some((port) => conflictPorts.has(port))) {
      matching.push(candidate.containerId);
    }
  }
  if (inspectionFailed) {
    return {
      ok: false,
      containerIds: [],
      message: "One or more Docker containers could not be inspected safely.",
    };
  }
  return { ok: true, containerIds: matching };
}

export async function stopStacksHoldingPorts(
  options: FindPreviousInstallContainersOptions,
): Promise<StopStacksHoldingPortsResult> {
  const authorized = await findPreviousInstallContainersHoldingPorts(options);
  if (!authorized.ok) {
    return { ok: false, stoppedCount: 0, message: authorized.message };
  }
  if (authorized.containerIds.length === 0) {
    return {
      ok: true,
      stoppedCount: 0,
      message: "No previous Vex services are holding the required ports.",
    };
  }

  const stopped = await stopContainers(authorized.containerIds, {
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    timeoutMs: ORPHAN_STACKS_STOP_TIMEOUT_MS,
  });
  if (stopped.code !== 0 || stopped.timedOut || stopped.aborted) {
    return {
      ok: false,
      stoppedCount: 0,
      message: "Previous Vex services could not be stopped completely.",
    };
  }
  return {
    ok: true,
    stoppedCount: authorized.containerIds.length,
    message: "Stopped previous Vex services holding the required ports.",
  };
}
