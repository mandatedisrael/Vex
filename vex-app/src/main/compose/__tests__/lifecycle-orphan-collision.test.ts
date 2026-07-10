import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderDeps } from "../render.js";

const mocks = vi.hoisted(() => ({
  renderCompose: vi.fn(),
  inspectEndpoint: vi.fn(),
  checkComposeFloor: vi.fn(),
  ensureDaemon: vi.fn(),
  isPortFree: vi.fn(),
  isOurProjectActive: vi.fn(),
  findPrevious: vi.fn(),
}));

vi.mock("../render.js", () => ({ renderCompose: mocks.renderCompose }));
vi.mock("../preflight.js", () => ({
  inspectDockerEndpointPolicy: mocks.inspectEndpoint,
  checkComposeFloor: mocks.checkComposeFloor,
  ensureDockerDaemonReady: mocks.ensureDaemon,
  isPortFree: mocks.isPortFree,
}));
vi.mock("../health.js", () => ({
  HEALTH_TIMEOUT_MS: 1,
  isOurProjectActive: mocks.isOurProjectActive,
  waitForHealth: vi.fn(),
}));
vi.mock("../orphan-stacks.js", () => ({
  findPreviousInstallContainersHoldingPorts: mocks.findPrevious,
}));
vi.mock("../embeddings-health.js", () => ({
  waitForEmbeddingsRuntimeReady: vi.fn(),
}));
vi.mock("../stale-secret-recovery.js", () => ({
  clearStaleSecretCache: vi.fn(),
  STALE_BIND_MOUNT_RE: /never/,
}));
vi.mock("../up.js", () => ({
  PULL_TIMEOUT_MS: 1,
  UP_TIMEOUT_MS: 1,
  composePull: vi.fn(),
  composeUpDetached: vi.fn(),
}));

import { composeUp } from "../lifecycle.js";

const deps: RenderDeps = {
  userDataDir: "/tmp/user-data",
  resourcesDir: "/tmp/resources",
  secretAdapter: {
    write: async (targetPath) => ({ composePath: targetPath }),
    read: async () => null,
    cleanup: async () => {},
    bootCleanup: async () => {},
  },
  randomAdapter: {
    uuid: () => "11111111-2222-4333-8444-555555555555",
    randomBytes: (size) => new Uint8Array(size),
  },
  cryptoAdapter: { base64url: () => "test" },
};

describe("composeUp previous-install port collision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectEndpoint.mockResolvedValue({ accepted: true });
    mocks.checkComposeFloor.mockResolvedValue(null);
    mocks.ensureDaemon.mockResolvedValue({ kind: "ready" });
    mocks.renderCompose.mockResolvedValue({
      outPath: "/tmp/compose/docker-compose.yml",
      installId: "11111111-2222-4333-8444-555555555555",
      embedPort: 27134,
      pgPasswordComposePath: "/tmp/secrets/pg_password",
    });
    mocks.isPortFree.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.isOurProjectActive.mockResolvedValue(false);
  });

  it("marks the collision when inspected previous-install containers hold it", async () => {
    mocks.findPrevious.mockResolvedValue({
      ok: true,
      containerIds: ["a".repeat(64)],
    });

    const result = await composeUp(deps, { pgPort: 27432 });

    expect(result.kind).toBe("port_collision");
    expect(result.previousInstallHoldingPorts).toBe(true);
    expect(result.conflictPorts).toEqual([27432]);
    expect(result.message).toMatch(/previous Vex installation/i);
    expect(mocks.findPrevious).toHaveBeenCalledWith({
      currentInstallId: "11111111-2222-4333-8444-555555555555",
      conflictPorts: [27432],
    });
  });

  it("keeps generic collision UX when no inspected Vex container matches", async () => {
    mocks.findPrevious.mockResolvedValue({ ok: true, containerIds: [] });

    const result = await composeUp(deps, { pgPort: 27432 });

    expect(result.kind).toBe("port_collision");
    expect(result.previousInstallHoldingPorts).toBe(false);
    expect(result.message).toMatch(/different process/i);
  });
});
