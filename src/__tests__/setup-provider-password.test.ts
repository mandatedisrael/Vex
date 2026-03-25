import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockWriteJsonSuccess = vi.fn();
const mockHandleSkillInstall = vi.fn(async () => {});

async function loadSetupCommand(root: string) {
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  process.env.OPENCLAW_HOME = join(root, "openclaw");
  vi.resetModules();
  vi.doMock("inquirer", () => ({
    default: {
      prompt: vi.fn(async () => ({ pw: "unused-password", pwConfirm: "unused-password" })),
    },
  }));
  vi.doMock("../utils/legacy-cleanup.js", () => ({
    runLegacyCleanupWithLog: vi.fn(),
  }));
  vi.doMock("../update/legacy-runtime.js", () => ({
    retireLegacyUpdateDaemon: vi.fn(async () => ({
      initial: {
        detected: false,
        pidFileExists: false,
        shutdownFileExists: false,
        stoppedFileExists: false,
        stateFileExists: false,
        logFileExists: false,
        pid: null,
        daemonRunning: false,
      },
      final: {
        detected: false,
        pidFileExists: false,
        shutdownFileExists: false,
        stoppedFileExists: false,
        stateFileExists: false,
        logFileExists: false,
        pid: null,
        daemonRunning: false,
      },
      stopSignalSent: false,
      shutdownRequested: false,
      forceKilled: false,
      cleanedFiles: [],
      warnings: [],
    })),
  }));
  vi.doMock("../openclaw/config.js", () => ({
    patchOpenclawSkillEnv: vi.fn(() => ({
      status: "updated",
      path: join(root, "openclaw", "openclaw.json"),
      keysSet: ["ECHO_KEYSTORE_PASSWORD"],
      keysSkipped: [],
    })),
    patchOpenclawConfig: vi.fn(() => ({ changed: false })),
    getSkillHooksEnv: vi.fn(() => ({})),
    loadOpenclawConfig: vi.fn(() => ({})),
    removeOpenclawConfigKey: vi.fn(() => ({ changed: false })),
  }));
  vi.doMock("../openclaw/hooks-client.js", () => ({
    validateHooksTokenSync: vi.fn(),
    buildMonitorAlertPayload: vi.fn(() => ({})),
    buildMarketMakerPayload: vi.fn(() => ({})),
    sendTestWebhook: vi.fn(async () => ({ ok: true })),
  }));
  vi.doMock("../setup/openclaw-link.js", () => ({
    linkOpenclawSkill: vi.fn(() => ({
      source: join(root, "src-skill"),
      target: join(root, "dst-skill"),
      linkType: "copy",
      workspaceTarget: undefined,
      workspaceLinked: false,
    })),
  }));
  vi.doMock("../utils/output.js", () => ({
    isHeadless: vi.fn(() => true),
    setJsonMode: vi.fn(),
    writeJsonSuccess: (...args: unknown[]) => mockWriteJsonSuccess(...args),
  }));
  vi.doMock("../commands/skill.js", () => ({
    handleSkillInstall: (...args: unknown[]) => mockHandleSkillInstall(...args),
  }));
  vi.doMock("../utils/ui.js", () => ({
    successBox: vi.fn(),
    warnBox: vi.fn(),
    infoBox: vi.fn(),
    colors: { bold: (s: string) => s, info: (s: string) => s, muted: (s: string) => s, value: (s: string) => s, warn: (s: string) => s, success: (s: string) => s, error: (s: string) => s },
  }));
  vi.doMock("../utils/respond.js", () => ({
    respond: vi.fn(),
  }));

  const setupModule = await import("../commands/setup.js");
  const pathsModule = await import("../config/paths.js");
  const envModule = await import("../providers/env-resolution.js");

  return {
    createSetupCommand: setupModule.createSetupCommand,
    envFile: pathsModule.ENV_FILE,
    readEnvValue: envModule.readEnvValue,
  };
}

describe("setup password + provider", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  const savedOpenclawHome = process.env.OPENCLAW_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;

    if (savedOpenclawHome === undefined) delete process.env.OPENCLAW_HOME;
    else process.env.OPENCLAW_HOME = savedOpenclawHome;
  });

  it("setup password writes to app env", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-setup-password-"));
    const { createSetupCommand, envFile, readEnvValue } = await loadSetupCommand(root);

    const setup = createSetupCommand();
    const passwordCmd = setup.commands.find((cmd) => cmd.name() === "password");
    expect(passwordCmd).toBeDefined();

    try {
      await passwordCmd!.parseAsync(["--password", "super-secret-pass", "--force"], { from: "user" });
      expect(mockWriteJsonSuccess).toHaveBeenCalledWith({
        status: "updated",
        path: envFile,
        keysSet: ["ECHO_KEYSTORE_PASSWORD"],
        keysSkipped: [],
        restartRequired: true,
        warnings: [],
      });

      expect(readEnvValue("ECHO_KEYSTORE_PASSWORD", envFile)).toBe("super-secret-pass");
      expect(readFileSync(envFile, "utf-8")).toContain("ECHO_KEYSTORE_PASSWORD");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("setup password --auto-update writes auto-update preference to env file", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-setup-password-autoupdate-"));
    const { createSetupCommand, envFile, readEnvValue } = await loadSetupCommand(root);

    const setup = createSetupCommand();
    const passwordCmd = setup.commands.find((cmd) => cmd.name() === "password");
    expect(passwordCmd).toBeDefined();

    try {
      await passwordCmd!.parseAsync(
        ["--password", "super-secret-pass", "--force", "--auto-update"],
        { from: "user" },
      );
      expect(mockWriteJsonSuccess).toHaveBeenCalledWith(expect.objectContaining({
        status: "updated",
        keysSet: ["ECHO_KEYSTORE_PASSWORD", "ECHO_AUTO_UPDATE"],
        restartRequired: true,
      }));

      expect(readEnvValue("ECHO_AUTO_UPDATE", envFile)).toBe("1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("setup provider delegates to skill installer flow", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-setup-provider-"));
    const { createSetupCommand } = await loadSetupCommand(root);

    const setup = createSetupCommand();
    const providerCmd = setup.commands.find((cmd) => cmd.name() === "provider");
    expect(providerCmd).toBeDefined();

    try {
      await providerCmd!.parseAsync(["--provider", "other", "--scope", "project"], { from: "user" });
      expect(mockHandleSkillInstall).toHaveBeenCalledWith({
        provider: "other",
        scope: "project",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
