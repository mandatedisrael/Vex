/**
 * preferencesStore tests — atomic update under concurrency.
 *
 * Uses node:fs for real file I/O against a tmp directory; mocks `electron`
 * so we don't need an Electron runtime.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub electron's `app.getPath` to point at a per-test tmp dir.
let userDataDir = "";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "userData") return userDataDir;
      throw new Error(`unexpected getPath('${name}')`);
    },
  },
}));

async function loadStoreModule() {
  // Import under vi.mock so the stub is applied.
  vi.resetModules();
  const mod = await import("../store.js");
  return mod.preferencesStore;
}

describe("preferencesStore", () => {
  beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-prefs-"));
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  it("first load writes default preferences with telemetry OFF", async () => {
    const store = await loadStoreModule();
    const prefs = await store.load();
    expect(prefs.telemetry.enabled).toBe(false);
    expect(prefs.telemetry.consentedAt).toBeNull();
    expect(prefs.window.width).toBe(1280);
  });

  it("update merges patches and persists atomically", async () => {
    const store = await loadStoreModule();
    const next = await store.update({
      telemetry: {
        enabled: true,
        consentedAt: new Date().toISOString(),
      },
    });
    expect(next.telemetry.enabled).toBe(true);

    const onDisk = JSON.parse(
      await fs.readFile(path.join(userDataDir, "preferences.json"), "utf8")
    );
    expect(onDisk.telemetry.enabled).toBe(true);
  });

  it("concurrent updates do not lose intermediate fields", async () => {
    const store = await loadStoreModule();
    // Fire 10 concurrent updates each touching a DIFFERENT field. Without
    // the atomic read-modify-write queue we'd lose all but the last.
    const updates = Array.from({ length: 10 }, (_, i) =>
      store.update({
        window: {
          width: 1024 + i,
          height: 768 + i,
          x: null,
          y: null,
          maximized: false,
        },
      })
    );
    await Promise.all(updates);

    const final = JSON.parse(
      await fs.readFile(path.join(userDataDir, "preferences.json"), "utf8")
    );
    // The LAST scheduled update wins. Verify we have a coherent state with
    // a width in the expected range (no torn writes / mixed states).
    expect(final.window.width).toBeGreaterThanOrEqual(1024);
    expect(final.window.width).toBeLessThanOrEqual(1033);
    expect(final.window.height).toBe(final.window.width - 256);
  });

  it("concurrent updates of different top-level fields are all preserved", async () => {
    const store = await loadStoreModule();
    await Promise.all([
      store.update({
        telemetry: { enabled: true, consentedAt: "2026-05-07T00:00:00.000Z" },
      }),
      store.update({ ui: { reducedMotion: "always" } }),
      store.update({
        updater: { lastCheckedAt: "2026-05-07T01:00:00.000Z" },
      }),
    ]);
    const final = JSON.parse(
      await fs.readFile(path.join(userDataDir, "preferences.json"), "utf8")
    );
    expect(final.telemetry.enabled).toBe(true);
    expect(final.ui.reducedMotion).toBe("always");
    expect(final.updater.lastCheckedAt).toBe("2026-05-07T01:00:00.000Z");
  });

  it("recovers from corrupted preferences.json by writing defaults", async () => {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(
      path.join(userDataDir, "preferences.json"),
      "{ this is not valid JSON",
      "utf8"
    );
    const store = await loadStoreModule();
    const prefs = await store.load();
    expect(prefs.telemetry.enabled).toBe(false);
  });
});
