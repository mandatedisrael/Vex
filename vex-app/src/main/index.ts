/**
 * Vex main process entrypoint.
 *
 * Order of operations:
 *   1. Acquire single-instance lock (refuse second launch, focus existing).
 *   2. Register custom app://vex/ scheme privileges (must precede app.ready).
 *   3. Install lifecycle hooks (window-all-closed, before-quit, will-quit).
 *   4. await app.whenReady().
 *   5. Install permission handlers (deny-all default).
 *   6. Install app://vex/ protocol handler.
 *   7. Register IPC handlers (Phase 1 surface).
 *   8. Open main window.
 */

import { app } from "electron";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ELECTRON_STATE_DIR } from "./paths/config-dir.js";
import { configureLogger, log } from "./logger/index.js";
import { acquireSingleInstanceLock } from "./lifecycle/single-instance.js";
import { installWindowAllClosedHook } from "./lifecycle/window-all-closed.js";
import { installBeforeQuitHook } from "./lifecycle/before-quit.js";
import { installPermissionHandlers } from "./permissions.js";
import {
  installAppProtocolHandler,
  registerAppProtocolPrivileges,
} from "./protocol/app-protocol.js";
import { registerAllIpcHandlers } from "./ipc/register-all.js";
import { cleanupOnBoot, cleanupOnQuit } from "./lifecycle/secret-cleanup.js";
import { globalCleanup } from "./lifecycle/cleanup-registry.js";
import { createMainWindow } from "./windows/main-window.js";
import {
  disableSentry,
  initSentryIfConsented,
} from "./telemetry/sentry-lifecycle.js";

/**
 * Remap Electron's userData onto CONFIG_DIR/.electron-state BEFORE any
 * code touches `app.getPath("userData")` (per Electron docs — once a path
 * is queried it caches). This unifies vex-app and vex-shell on a single
 * shared CONFIG_DIR (main plan §39-43): shared `.env`, `keystore.json`,
 * `.install-id`, etc. live at CONFIG_DIR root; Chromium cache, the
 * preferences store, electron-log files all nest under
 * CONFIG_DIR/.electron-state and stay invisible to vex-shell.
 */
mkdirSync(ELECTRON_STATE_DIR, { recursive: true });
app.setPath("userData", ELECTRON_STATE_DIR);

configureLogger();

/**
 * WSL2 GPU mitigation: WSLg's virtualized GPU sometimes fails Chromium's
 * command-buffer init with `kTransientFailure`. Disable hardware acceleration
 * proactively so we always render in software on WSL — non-WSL platforms
 * keep full GPU acceleration. Must run BEFORE app.whenReady().
 */
function isWSL2(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const release = readFileSync("/proc/version", "utf8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

if (isWSL2()) {
  // Primary fix: software rendering. WSLg's vGPU produces transient
  // ContextResult::kTransientFailure on Chromium command-buffer init.
  app.disableHardwareAcceleration();
  // SwiftShader software GL is the cleanest fallback when WebGL is touched
  // (Hugeicons / motion / canvas paint). Non-WSL platforms keep full GPU.
  app.commandLine.appendSwitch("use-gl", "swiftshader");
  // NOTE: disable-gpu-sandbox intentionally NOT applied — WSLg's GPU sandbox
  // works once HW accel is off, and disabling it weakens process isolation.
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Single instance — refuse second launch
if (!acquireSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// 2. Privileged scheme registration — must run before app.ready
registerAppProtocolPrivileges();

// 3. Lifecycle hooks
installWindowAllClosedHook();
installBeforeQuitHook();

app.whenReady().then(async () => {
  log.info("[main] app.whenReady — initializing");
  // 4. Security: deny-all permission handlers
  installPermissionHandlers();

  // 5. Custom protocol — renderer dist root resolved relative to main bundle
  const rendererRoot = app.isPackaged
    ? path.resolve(__dirname, "../renderer")
    : path.resolve(__dirname, "../../dist/renderer");
  installAppProtocolHandler(rendererRoot);

  // 6. IPC surface
  registerAllIpcHandlers();

  // 6a. Register lifecycle-driven cleanup. cleanupOnQuit will run inside
  // the will-quit hook via globalCleanup; cleanupOnBoot runs once now to
  // sweep orphaned transient secrets from a prior crashed session.
  globalCleanup.add(() => cleanupOnQuit());
  void cleanupOnBoot().catch((err) => {
    log.error("[main] cleanupOnBoot failed", err);
  });

  // 6b. Sentry — honors prior opt-in if any. Idempotent + lazy-imports the
  // SDK only when consent + DSN are both present (codex v3 hard fix #2).
  // Tear-down on quit closes the transport + clears the offline queue.
  void initSentryIfConsented().catch((err) => {
    log.error("[main] initSentryIfConsented failed", err);
  });
  globalCleanup.add(async () => {
    await disableSentry();
  });

  // 7. Main window
  await createMainWindow();
});

app.on("activate", async () => {
  // macOS: re-create window when dock icon clicked + no windows open
  const { BrowserWindow } = await import("electron");
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});
