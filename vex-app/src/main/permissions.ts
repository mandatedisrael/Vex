/**
 * Permission handlers — deny-all default per skill §7.
 *
 * Vex doesn't need camera, mic, geolocation, USB, midi, etc. for Phase 1.
 * Wallet UI is read-write but goes through main-process IPC (not browser
 * permissions API). Add explicit allowlists later only with product sign-off.
 */

import { session } from "electron";

export function installPermissionHandlers(): void {
  const s = session.defaultSession;

  s.setPermissionCheckHandler(() => false);

  s.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  s.setDevicePermissionHandler(() => false);

  s.setDisplayMediaRequestHandler(
    (_request, callback) => {
      callback({ video: undefined, audio: undefined });
    },
    { useSystemPicker: false }
  );
}
