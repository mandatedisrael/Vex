export function isAppTranslocated(
  execPath: string,
  platform: NodeJS.Platform,
): boolean {
  return platform === "darwin" && execPath.includes("/AppTranslocation/");
}
