/**
 * Standard macOS dock semantics: app stays alive when all windows are closed
 * on darwin (user re-opens via dock); quit on win32/linux.
 */

import { app } from "electron";

export function installWindowAllClosedHook(): void {
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
