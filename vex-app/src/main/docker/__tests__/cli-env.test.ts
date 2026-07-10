import { describe, expect, it, vi } from "vitest";

import { buildDockerPath } from "../cli-env.js";

const DARWIN_CANDIDATES = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/Users/test/.docker/bin",
  "/Users/test/.orbstack/bin",
  "/Users/test/.rd/bin",
  "/Applications/Docker.app/Contents/Resources/bin",
];

const LINUX_CANDIDATES = [
  "/usr/local/bin",
  "/usr/bin",
  "/snap/bin",
  "/home/test/bin",
];

describe("buildDockerPath", () => {
  it.each([
    ["darwin", "/Users/test", DARWIN_CANDIDATES],
    ["linux", "/home/test", LINUX_CANDIDATES],
  ] as const)(
    "appends the %s candidate matrix after inherited PATH",
    (platform, homedir, candidates) => {
      const env = { PATH: "/system/bin:/custom/bin", KEEP: "yes" };

      const result = buildDockerPath({
        platform,
        homedir,
        env,
        dirExists: () => true,
      });

      expect(result).not.toBe(env);
      expect(result.KEEP).toBe("yes");
      expect(result.PATH?.split(":")).toEqual([
        "/system/bin",
        "/custom/bin",
        ...candidates,
      ]);
    },
  );

  it("appends only existing directories and deduplicates inherited entries", () => {
    const dirExists = vi.fn((candidate: string) => candidate !== "/snap/bin");

    const result = buildDockerPath({
      platform: "linux",
      homedir: "/home/test",
      env: { PATH: "/usr/bin:/custom/bin" },
      dirExists,
    });

    expect(result.PATH).toBe(
      "/usr/bin:/custom/bin:/usr/local/bin:/home/test/bin",
    );
    expect(dirExists).not.toHaveBeenCalledWith("/usr/bin");
  });

  it("resolves HOME-relative candidates from the injected homedir", () => {
    const result = buildDockerPath({
      platform: "darwin",
      homedir: "/custom/home",
      env: { PATH: "/bin" },
      dirExists: (candidate) => candidate.startsWith("/custom/home/"),
    });

    expect(result.PATH).toBe(
      "/bin:/custom/home/.docker/bin:/custom/home/.orbstack/bin:/custom/home/.rd/bin",
    );
  });

  it("returns the Windows environment object untouched", () => {
    const env = { Path: "C:\\Windows", PATH: "C:\\Tools", KEEP: "yes" };
    const dirExists = vi.fn(() => true);

    const result = buildDockerPath({
      platform: "win32",
      homedir: "C:\\Users\\test",
      env,
      dirExists,
    });

    expect(result).toBe(env);
    expect(result).toEqual({
      Path: "C:\\Windows",
      PATH: "C:\\Tools",
      KEEP: "yes",
    });
    expect(dirExists).not.toHaveBeenCalled();
  });
});
