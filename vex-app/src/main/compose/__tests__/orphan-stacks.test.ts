import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpawnRunnerResult } from "../../docker/spawn-runner.js";

const runSpawnMock = vi.hoisted(() => vi.fn());

vi.mock("../../docker/spawn-runner.js", () => ({ runSpawn: runSpawnMock }));

import {
  ORPHAN_STACKS_TIMEOUT_MS,
  ORPHAN_STACKS_STOP_TIMEOUT_MS,
  findPreviousInstallContainersHoldingPorts,
  parsePreviousInstallCandidates,
  parsePublishedHostPorts,
  stopStacksHoldingPorts,
} from "../orphan-stacks.js";

const CURRENT_INSTALL_ID = "11111111-2222-4333-8444-555555555555";
const PREVIOUS_INSTALL_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PREVIOUS_INSTALL_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const ID_A = "a".repeat(64);
const ID_B = "b".repeat(64);

function spawnResult(
  partial: Partial<SpawnRunnerResult> = {},
): SpawnRunnerResult {
  return {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    aborted: false,
    timedOut: false,
    ...partial,
  };
}

function portsFixture(hostPort: number): string {
  return JSON.stringify({
    "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: String(hostPort) }],
    "8080/tcp": null,
  });
}

describe("previous-install candidate parsing", () => {
  it("keeps only strict previous vex UUID project labels and full IDs", () => {
    const stdout = [
      `${ID_A}\tvex-${PREVIOUS_INSTALL_A}`,
      `${ID_B}\tvex-${CURRENT_INSTALL_ID}`,
      `${"c".repeat(64)}\tvex-foo`,
      `${"d".repeat(64)}\tvex-123`,
      `${"e".repeat(64)}\tother-project`,
      "malformed-without-tab",
      `${"f".repeat(12)}\tvex-${PREVIOUS_INSTALL_B}`,
      `${"0".repeat(64)}\tvex-${PREVIOUS_INSTALL_B}\textra`,
    ].join("\n");

    expect(parsePreviousInstallCandidates(stdout, CURRENT_INSTALL_ID)).toEqual([
      { containerId: ID_A, project: `vex-${PREVIOUS_INSTALL_A}` },
    ]);
  });
});

describe("Docker inspect port authorization", () => {
  it("parses published host ports and accepts null port maps", () => {
    expect(parsePublishedHostPorts(portsFixture(27432))).toEqual([27432]);
    expect(parsePublishedHostPorts('{"5432/tcp":null}')).toEqual([]);
  });

  it("returns no authorization for malformed or non-matching inspect data", () => {
    expect(parsePublishedHostPorts("not-json")).toBeNull();
    expect(parsePublishedHostPorts('{"5432/tcp":[{"HostPort":27432}]}'))
      .toBeNull();
  });

  it("offers no stop when an unrelated Vex stack does not publish the occupied port", async () => {
    runSpawnMock
      .mockResolvedValueOnce(
        spawnResult({ stdout: `${ID_A}\tvex-${PREVIOUS_INSTALL_A}\n` }),
      )
      .mockResolvedValueOnce(spawnResult({ stdout: portsFixture(39999) }));

    const result = await findPreviousInstallContainersHoldingPorts({
      currentInstallId: CURRENT_INSTALL_ID,
      conflictPorts: [27432],
    });

    expect(result).toEqual({ ok: true, containerIds: [] });
  });

  it("fails closed when candidate inspection cannot be validated", async () => {
    runSpawnMock
      .mockResolvedValueOnce(
        spawnResult({ stdout: `${ID_A}\tvex-${PREVIOUS_INSTALL_A}\n` }),
      )
      .mockResolvedValueOnce(
        spawnResult({ code: 1, stderr: "inspect failed" }),
      );

    const result = await findPreviousInstallContainersHoldingPorts({
      currentInstallId: CURRENT_INSTALL_ID,
      conflictPorts: [27432],
    });

    expect(result).toMatchObject({ ok: false, containerIds: [] });
  });
});

describe("stopStacksHoldingPorts", () => {
  beforeEach(() => {
    runSpawnMock.mockReset();
  });

  it("re-derives and re-inspects, then stops only matching full IDs", async () => {
    const psOutput = [
      `${ID_A}\tvex-${PREVIOUS_INSTALL_A}`,
      `${ID_B}\tvex-${PREVIOUS_INSTALL_B}`,
    ].join("\n");
    runSpawnMock.mockImplementation(
      (_command: string, args: readonly string[]) => {
        if (args[0] === "ps") return Promise.resolve(spawnResult({ stdout: psOutput }));
        if (args[0] === "inspect" && args.at(-1) === ID_A) {
          return Promise.resolve(spawnResult({ stdout: portsFixture(27432) }));
        }
        if (args[0] === "inspect") {
          return Promise.resolve(spawnResult({ stdout: portsFixture(39999) }));
        }
        return Promise.resolve(spawnResult({ stdout: `${ID_A}\n` }));
      },
    );

    const detected = await findPreviousInstallContainersHoldingPorts({
      currentInstallId: CURRENT_INSTALL_ID,
      conflictPorts: [27432],
    });
    const stopped = await stopStacksHoldingPorts({
      currentInstallId: CURRENT_INSTALL_ID,
      conflictPorts: [27432],
    });

    expect(detected).toEqual({ ok: true, containerIds: [ID_A] });
    expect(stopped).toMatchObject({ ok: true, stoppedCount: 1 });
    expect(runSpawnMock.mock.calls.filter((call) => call[1][0] === "ps"))
      .toHaveLength(2);
    expect(
      runSpawnMock.mock.calls.filter(
        (call) => call[1][0] === "inspect" && call[1].at(-1) === ID_A,
      ),
    ).toHaveLength(2);
    expect(runSpawnMock).toHaveBeenLastCalledWith(
      "docker",
      ["stop", ID_A],
      expect.objectContaining({ timeoutMs: ORPHAN_STACKS_STOP_TIMEOUT_MS }),
    );
    const discoveryCalls = runSpawnMock.mock.calls.filter(
      (call) => call[1][0] === "ps" || call[1][0] === "inspect",
    );
    for (const call of discoveryCalls) {
      expect(call[2]).toEqual(
        expect.objectContaining({ timeoutMs: ORPHAN_STACKS_TIMEOUT_MS }),
      );
    }
  });

  it("passes timeout and AbortSignal through every Docker command", async () => {
    const controller = new AbortController();
    runSpawnMock.mockResolvedValue(
      spawnResult({ timedOut: true, code: null, stderr: "timed out" }),
    );

    const result = await stopStacksHoldingPorts({
      currentInstallId: CURRENT_INSTALL_ID,
      conflictPorts: [27432],
      signal: controller.signal,
    });

    expect(result).toMatchObject({ ok: false, stoppedCount: 0 });
    expect(runSpawnMock).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["ps"]),
      expect.objectContaining({
        signal: controller.signal,
        timeoutMs: ORPHAN_STACKS_TIMEOUT_MS,
      }),
    );
  });

  it("reports a nonzero partial stop as failure", async () => {
    runSpawnMock
      .mockResolvedValueOnce(
        spawnResult({ stdout: `${ID_A}\tvex-${PREVIOUS_INSTALL_A}\n` }),
      )
      .mockResolvedValueOnce(spawnResult({ stdout: portsFixture(27432) }))
      .mockResolvedValueOnce(
        spawnResult({ code: 1, stdout: `${ID_A}\n`, stderr: "stop failed" }),
      );

    const result = await stopStacksHoldingPorts({
      currentInstallId: CURRENT_INSTALL_ID,
      conflictPorts: [27432],
    });

    expect(result).toMatchObject({ ok: false, stoppedCount: 0 });
  });
});
