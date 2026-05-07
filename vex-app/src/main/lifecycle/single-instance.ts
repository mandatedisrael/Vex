/**
 * Single instance lock — drugą instancję odmawiamy startu (focus existing window).
 *
 * Krytyczne dla shared keystore + DB: dwa procesy współbieżnie pisałyby do .env,
 * keystore.json, preferences.json — race conditions, corrupted state, double-unlock.
 *
 * Skill §10 implicit: "user app instance owns local infra contract".
 */

import { app, BrowserWindow } from "electron";

/**
 * @returns true if this is the primary instance and execution should continue.
 * @returns false if a primary instance is already running — caller MUST app.quit() immediately.
 */
export function acquireSingleInstanceLock(): boolean {
  const acquired = app.requestSingleInstanceLock();

  if (!acquired) {
    return false;
  }

  app.on("second-instance", () => {
    const windows = BrowserWindow.getAllWindows();
    const primary = windows.find((w) => !w.isDestroyed());
    if (primary) {
      if (primary.isMinimized()) primary.restore();
      primary.focus();
    }
  });

  return true;
}
