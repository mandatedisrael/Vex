/**
 * Shared flag: is an AMBIENT (auto) update check in flight?
 *
 * electron-updater emits the `error` event (then rethrows) from
 * `checkForUpdates()`. The `configureUpdater` error listener would otherwise
 * map that to a user-facing error banner — but an ambient start/focus check
 * (possibly against a not-yet-configured feed) must NOT nag. The listener
 * consults this flag and suppresses the banner only while a silent check is
 * active; manual check / download / install errors leave the flag false and
 * surface normally.
 */

let silentCheckActive = false;

export function setSilentCheckActive(value: boolean): void {
  silentCheckActive = value;
}

export function isSilentCheckActive(): boolean {
  return silentCheckActive;
}
