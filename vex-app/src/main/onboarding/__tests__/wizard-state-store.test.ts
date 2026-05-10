/**
 * WizardStateStore tests — atomic update under concurrency, schema
 * recovery, and forward-safe transition enforcement on update.
 *
 * The store accepts a `filePath` override so we use real fs against a
 * tmp dir without needing to mock electron.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WizardStateStore } from "../wizard-state-store.js";

let tmpDir = "";
let filePath = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-wizard-state-"));
  filePath = path.join(tmpDir, "wizard-state.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("WizardStateStore.load", () => {
  it("first load writes the canonical defaults", async () => {
    const store = new WizardStateStore({ filePath });
    const state = await store.load();
    expect(state.schemaVersion).toBe(1);
    expect(state.currentStepId).toBe("keystore");
    expect(state.completedSteps).toEqual([]);
    expect(state.completed).toBe(false);

    const onDisk = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(onDisk).toEqual(state);
  });

  it("recovers from corrupted JSON by rewriting defaults", async () => {
    await fs.writeFile(filePath, "{ not json", "utf8");
    const store = new WizardStateStore({ filePath });
    const state = await store.load();
    expect(state.currentStepId).toBe("keystore");

    const onDisk = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(onDisk.currentStepId).toBe("keystore");
  });

  it("recovers from schema-invalid file by rewriting defaults", async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 999,
        currentStepId: "unknown",
        completedSteps: [],
        completed: false,
      }),
      "utf8"
    );
    const store = new WizardStateStore({ filePath });
    const state = await store.load();
    expect(state.schemaVersion).toBe(1);
    expect(state.currentStepId).toBe("keystore");
  });
});

describe("WizardStateStore.update", () => {
  it("merges currentStepId + completedSteps and persists atomically", async () => {
    const store = new WizardStateStore({ filePath });
    const next = await store.update({
      currentStepId: "wallets",
      completedSteps: ["keystore"],
    });
    expect(next.currentStepId).toBe("wallets");
    expect(next.completedSteps).toEqual(["keystore"]);
    expect(next.completed).toBe(false);

    const onDisk = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(onDisk.currentStepId).toBe("wallets");
  });

  it("preserves prior `completed` when not present in the input", async () => {
    const store = new WizardStateStore({ filePath });
    await store.update({
      currentStepId: "review",
      completedSteps: [
        "keystore",
        "wallets",
        "apiKeys",
        "embedding",
        "agentCore",
        "provider",
        "mode",
        "wake",
      ],
      completed: true,
    });
    // Subsequent update without `completed` keeps it true.
    const next = await store.update({
      currentStepId: "review",
      completedSteps: [
        "keystore",
        "wallets",
        "apiKeys",
        "embedding",
        "agentCore",
        "provider",
        "mode",
        "wake",
      ],
    });
    expect(next.completed).toBe(true);
  });

  it("rejects backward transitions at the merge layer", async () => {
    const store = new WizardStateStore({ filePath });
    await expect(
      store.update({
        currentStepId: "keystore",
        completedSteps: ["wallets"],
      })
    ).rejects.toThrow();
  });

  it("rejects duplicate completedSteps entries", async () => {
    const store = new WizardStateStore({ filePath });
    await expect(
      store.update({
        currentStepId: "wallets",
        completedSteps: ["keystore", "keystore"],
      })
    ).rejects.toThrow();
  });

  it("serializes concurrent updates so neither write is torn", async () => {
    const store = new WizardStateStore({ filePath });
    // Fire 5 concurrent updates that walk the steps forward. Without
    // the enqueue chain we'd see torn JSON or lost state.
    const updates = [
      store.update({ currentStepId: "wallets", completedSteps: ["keystore"] }),
      store.update({
        currentStepId: "apiKeys",
        completedSteps: ["keystore", "wallets"],
      }),
      store.update({
        currentStepId: "embedding",
        completedSteps: ["keystore", "wallets", "apiKeys"],
      }),
      store.update({
        currentStepId: "agentCore",
        completedSteps: ["keystore", "wallets", "apiKeys", "embedding"],
      }),
      store.update({
        currentStepId: "provider",
        completedSteps: [
          "keystore",
          "wallets",
          "apiKeys",
          "embedding",
          "agentCore",
        ],
      }),
    ];
    await Promise.all(updates);

    const onDisk = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(onDisk.currentStepId).toBe("provider");
    expect(onDisk.completedSteps).toEqual([
      "keystore",
      "wallets",
      "apiKeys",
      "embedding",
      "agentCore",
    ]);
  });

  it("a fresh store instance reads the persisted state from a previous run", async () => {
    const first = new WizardStateStore({ filePath });
    await first.update({
      currentStepId: "wallets",
      completedSteps: ["keystore"],
    });

    const second = new WizardStateStore({ filePath });
    const state = await second.load();
    expect(state.currentStepId).toBe("wallets");
    expect(state.completedSteps).toEqual(["keystore"]);
  });
});
