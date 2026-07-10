import { beforeEach, describe, expect, it, vi } from "vitest";

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  dockerSpawnEnv: vi.fn(() => ({ PATH: "/docker/path" })),
  inspectEndpoint: vi.fn(),
  isPortFree: vi.fn(),
  isModelRunnerReachable: vi.fn(),
  getAvailableDiskGB: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const execFile = (...args: unknown[]): unknown => mocks.execFile(...args);
  Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), {
    value: (
      command: string,
      args: ReadonlyArray<string>,
      options: unknown,
    ): Promise<{ stdout: string; stderr: string }> =>
      new Promise((resolve, reject) => {
        mocks.execFile(
          command,
          args,
          options,
          (error: Error | null, stdout: string, stderr: string) => {
            if (error !== null) {
              reject(Object.assign(error, { stdout, stderr }));
              return;
            }
            resolve({ stdout, stderr });
          },
        );
      }),
  });
  return { execFile };
});
vi.mock("../cli-env.js", () => ({ dockerSpawnEnv: mocks.dockerSpawnEnv }));
vi.mock("../endpoint-policy.js", () => ({
  inspectDockerEndpointPolicy: mocks.inspectEndpoint,
}));
vi.mock("../probe/ports.js", () => ({
  isPortFree: mocks.isPortFree,
  isModelRunnerEndpointReachable: mocks.isModelRunnerReachable,
}));
vi.mock("../probe/disk.js", () => ({
  getAvailableDiskGB: mocks.getAvailableDiskGB,
}));
vi.mock("../../logger/index.js", () => ({
  log: { warn: mocks.logWarn },
}));

import { probeDocker } from "../probe/daemon.js";

function commandError(code: string): Error {
  return Object.assign(new Error(`docker failed (${code})`), {
    code,
    stdout: "",
    stderr: "safe diagnostic",
  });
}

function installExecBehavior(
  behavior: (
    args: ReadonlyArray<string>,
  ) => { stdout?: string; error?: Error },
): void {
  mocks.execFile.mockImplementation(
    (
      _command: string,
      args: ReadonlyArray<string>,
      _options: unknown,
      callback: ExecCallback,
    ) => {
      const response = behavior(args);
      callback(response.error ?? null, response.stdout ?? "", "");
      return undefined;
    },
  );
}

describe("probeDocker engine failure taxonomy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectEndpoint.mockResolvedValue({
      accepted: true,
      currentContext: "default",
      dockerHostSet: false,
      reason: null,
      message: null,
    });
    mocks.isPortFree.mockResolvedValue(true);
    mocks.isModelRunnerReachable.mockResolvedValue(false);
    mocks.getAvailableDiskGB.mockResolvedValue(50);
  });

  it("classifies ENOENT version failures as cli_not_found", async () => {
    installExecBehavior(() => ({ error: commandError("ENOENT") }));

    const status = await probeDocker({ pgPort: 55432, diskTarget: "/tmp" });

    expect(status.engine).toEqual({
      present: false,
      version: null,
      runtimeOK: false,
      failure: "cli_not_found",
    });
  });

  it("classifies non-ENOENT version failures as probe_error", async () => {
    installExecBehavior(() => ({ error: commandError("EACCES") }));

    const status = await probeDocker({ pgPort: 55432, diskTarget: "/tmp" });

    expect(status.engine.present).toBe(false);
    expect(status.engine.failure).toBe("probe_error");
  });

  it("keeps engine failure null when version succeeds but docker info fails", async () => {
    installExecBehavior((args) => {
      const key = args.join(" ");
      if (key === "--version") {
        return { stdout: "Docker version 27.5.1, build abc\n" };
      }
      if (key === "compose version") {
        return { stdout: "Docker Compose version v2.32.4\n" };
      }
      if (key === "model status") {
        return { stdout: "Docker Model Runner is running\n" };
      }
      return { error: commandError("ECONNREFUSED") };
    });

    const status = await probeDocker({ pgPort: 55432, diskTarget: "/tmp" });

    expect(status.engine.present).toBe(true);
    expect(status.engine.failure).toBeNull();
    expect(status.daemon.running).toBe(false);
    expect(mocks.dockerSpawnEnv).toHaveBeenCalled();
    expect(mocks.execFile).toHaveBeenCalledWith(
      "docker",
      expect.any(Array),
      expect.objectContaining({ env: { PATH: "/docker/path" } }),
      expect.any(Function),
    );
  });
});
