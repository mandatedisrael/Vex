/**
 * Electron Fuses applied in afterPack hook (skill §7).
 * Flips fuses BEFORE codesigning so signature covers the modified binary.
 *
 * Mandatory production-grade flags (even for unsigned dev builds):
 *   - RunAsNode: false
 *   - EnableNodeOptionsEnvironmentVariable: false
 *   - EnableNodeCliInspectArguments: false
 *   - EnableEmbeddedAsarIntegrityValidation: true
 *   - OnlyLoadAppFromAsar: true
 *   - EnableCookieEncryption: true
 *   - GrantFileProtocolExtraPrivileges: false
 *
 * Run via electron-builder `afterPack` hook.
 */

import path from "node:path";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";

export default async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  let appPath;
  if (electronPlatformName === "darwin") {
    appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  } else if (electronPlatformName === "win32") {
    appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
  } else if (electronPlatformName === "linux") {
    appPath = path.join(appOutDir, packager.executableName);
  } else {
    return;
  }

  await flipFuses(appPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
}
