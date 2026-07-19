import { statSync } from "node:fs";
import { homedir as getHomedir } from "node:os";
import { posix } from "node:path";
import { withoutManagedSecrets } from "./env-hygiene.js";

export interface BuildDockerPathOptions {
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly dirExists: (path: string) => boolean;
}

function dockerPathCandidates(
  platform: NodeJS.Platform,
  homedir: string,
): ReadonlyArray<string> {
  if (platform === "darwin") {
    return [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      posix.join(homedir, ".docker/bin"),
      posix.join(homedir, ".orbstack/bin"),
      posix.join(homedir, ".rd/bin"),
      "/Applications/Docker.app/Contents/Resources/bin",
    ];
  }
  if (platform === "linux") {
    return [
      "/usr/local/bin",
      "/usr/bin",
      "/snap/bin",
      posix.join(homedir, "bin"),
    ];
  }
  return [];
}

/**
 * Builds the environment used for Docker CLI processes. Existing PATH entries
 * retain priority; only present, missing candidates are appended.
 *
 * Windows is deliberately returned by identity. Rebuilding its environment
 * can collapse duplicate PATH/Path keys before Node launches the child.
 */
export function buildDockerPath(
  options: BuildDockerPathOptions,
): NodeJS.ProcessEnv {
  const { platform, homedir, env, dirExists } = options;
  if (platform === "win32") return env;

  const inheritedPath = env.PATH ?? "";
  const knownEntries = new Set(inheritedPath.split(":").filter(Boolean));
  const appended = dockerPathCandidates(platform, homedir).filter(
    (candidate) => !knownEntries.has(candidate) && dirExists(candidate),
  );
  const path = [inheritedPath, ...appended].filter(Boolean).join(":");

  return { ...env, PATH: path };
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recomputes Docker CLI candidates per spawn so Recheck sees new installs,
 * and strips managed secrets so the Docker CLI/compose child never inherits
 * the master password or vault-managed API keys.
 */
export function dockerSpawnEnv(): NodeJS.ProcessEnv {
  return withoutManagedSecrets(
    buildDockerPath({
      platform: process.platform,
      homedir: getHomedir(),
      env: process.env,
      dirExists: directoryExists,
    }),
  );
}
