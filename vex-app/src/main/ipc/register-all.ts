/**
 * Centralised IPC registration. Phase 1 surface only.
 *
 * Each handler returns its own teardown fn — they all flow into globalCleanup
 * so app quit / reload removes them cleanly.
 */

import { globalCleanup } from "../lifecycle/cleanup-registry.js";
import { registerCapabilitiesHandler } from "./capabilities.js";
import { registerSettingsHandlers } from "./settings.js";
import { registerSystemHandlers } from "./system.js";
import { registerTelemetryHandler } from "./telemetry.js";

export function registerAllIpcHandlers(): void {
  const teardowns: Array<() => void> = [];

  teardowns.push(registerCapabilitiesHandler());
  teardowns.push(...registerSystemHandlers());
  teardowns.push(...registerSettingsHandlers());
  teardowns.push(registerTelemetryHandler());

  globalCleanup.add(() => {
    for (const t of teardowns) t();
  });
}
