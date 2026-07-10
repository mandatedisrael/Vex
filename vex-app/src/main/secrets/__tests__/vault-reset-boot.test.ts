import { describe, expect, it, vi } from "vitest";
import type { MessageBoxOptions } from "electron";
import {
  orchestrateEarlyBoot,
  presentVaultResetRecovery,
  type RecoveryDialogDeps,
} from "../vault-reset-boot.js";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function dialogDeps(responses: number[]) {
  return {
    showMessageBox: vi.fn(async (_options: MessageBoxOptions) => ({
      response: responses.shift() ?? 1,
      checkboxChecked: false,
    })),
    openLogsFolder: vi.fn(async () => true),
    clearJournal: vi.fn(async () => undefined),
    quit: vi.fn(),
  } satisfies RecoveryDialogDeps;
}

describe("vault reset recovery dialog loop", () => {
  it("open logs redisplays, then recoverable cancel clears only the journal", async () => {
    const deps = dialogDeps([0, 1]);
    expect(await presentVaultResetRecovery("recoverable-request-failure", deps)).toBe("continueBoot");
    expect(deps.openLogsFolder).toHaveBeenCalledTimes(1);
    expect(deps.showMessageBox).toHaveBeenCalledTimes(2);
    expect(deps.clearJournal).toHaveBeenCalledTimes(1);
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it("openPath failure redisplays with safe fallback copy", async () => {
    const deps = dialogDeps([0, 2]);
    deps.openLogsFolder.mockResolvedValue(false);
    expect(await presentVaultResetRecovery("recoverable-request-failure", deps)).toBe("quitRequested");
    expect(deps.showMessageBox.mock.calls[1]![0].detail).toContain("could not be opened automatically");
  });

  it("cancel unlink failure escalates to unsafe dialog with no cancel", async () => {
    const deps = dialogDeps([1, 1]);
    deps.clearJournal.mockRejectedValue(new Error("private path"));
    expect(await presentVaultResetRecovery("recoverable-request-failure", deps)).toBe("quitRequested");
    expect(deps.showMessageBox.mock.calls[1]![0].buttons).toEqual(["Open logs folder", "Quit"]);
    expect(deps.quit).toHaveBeenCalledTimes(1);
  });

  it("unsafe state offers no continue path", async () => {
    const deps = dialogDeps([1]);
    expect(await presentVaultResetRecovery("unsafe-recovery-state", deps)).toBe("quitRequested");
    expect(deps.showMessageBox.mock.calls[0]![0].buttons).toEqual(["Open logs folder", "Quit"]);
  });
});

describe("early boot ordering", () => {
  it("runs recovery before env and runtime dependencies", async () => {
    const order: string[] = [];
    expect(await orchestrateEarlyBoot({
      recover: async () => { order.push("recover"); return "no-op"; },
      presentRecovery: async () => { order.push("dialog"); return "continueBoot"; },
      loadEnvironment: () => order.push("env"),
      initializeRuntime: async () => { order.push("ipc-windows-workers"); },
    })).toBe("continueBoot");
    expect(order).toEqual(["recover", "dialog", "env", "ipc-windows-workers"]);
  });

  it("quit disposition prevents env, IPC, windows, and workers", async () => {
    const loadEnvironment = vi.fn();
    const initializeRuntime = vi.fn(async () => undefined);
    expect(await orchestrateEarlyBoot({
      recover: async () => "unsafe-recovery-state",
      presentRecovery: async () => "quitRequested",
      loadEnvironment,
      initializeRuntime,
    })).toBe("quitRequested");
    expect(loadEnvironment).not.toHaveBeenCalled();
    expect(initializeRuntime).not.toHaveBeenCalled();
  });
});
