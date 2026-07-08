/**
 * Tests for shared/schemas/wizard.ts — the single source of truth
 * for wizard step ordering, password validation, IPC payload shapes,
 * and persisted wizard-state.json invariants. Schema drift between
 * sidebar / handlers / store is caught here.
 */

import { describe, expect, it } from "vitest";
import {
  WIZARD_STEP_IDS,
  defaultWizardState,
  keystorePasswordSchema,
  keystoreSetInputSchema,
  keystoreSetResultSchema,
  setWizardStateInputSchema,
  wizardStateSchema,
  wizardStepIdSchema,
} from "../wizard.js";

describe("WIZARD_STEP_IDS canonical order", () => {
  it("contains exactly the seven wizard steps in setup order", () => {
    expect(WIZARD_STEP_IDS).toEqual([
      "keystore",
      "wallets",
      "apiKeys",
      "embedding",
      "agentCore",
      "provider",
      "review",
    ]);
  });

  it("wizardStepIdSchema accepts all canonical ids and rejects unknown", () => {
    for (const id of WIZARD_STEP_IDS) {
      expect(wizardStepIdSchema.parse(id)).toBe(id);
    }
    expect(wizardStepIdSchema.safeParse("not-a-step").success).toBe(false);
    expect(wizardStepIdSchema.safeParse("").success).toBe(false);
  });
});

describe("keystorePasswordSchema (form-side)", () => {
  it("accepts a 10+ char password with matching confirm", () => {
    const r = keystorePasswordSchema.safeParse({
      password: "passw0rd12",
      confirm: "passw0rd12",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a password shorter than PASSWORD_CREATE_MIN (10) chars", () => {
    const r = keystorePasswordSchema.safeParse({
      password: "short123",
      confirm: "short123",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const passwordIssue = r.error.issues.find((i) =>
        i.path.includes("password")
      );
      expect(passwordIssue).toBeDefined();
    }
  });

  it("rejects mismatched confirm with the path pointing at confirm", () => {
    const r = keystorePasswordSchema.safeParse({
      password: "correct horse",
      confirm: "wrong battery",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const confirmIssue = r.error.issues.find((i) =>
        i.path.includes("confirm")
      );
      expect(confirmIssue?.message).toMatch(/do not match/i);
    }
  });
});

describe("keystoreSetInputSchema (IPC boundary)", () => {
  it("accepts {password} of PASSWORD_CREATE_MIN (10)+ chars", () => {
    expect(
      keystoreSetInputSchema.safeParse({ password: "1234567890" }).success
    ).toBe(true);
  });

  it("rejects extra fields (strict)", () => {
    expect(
      keystoreSetInputSchema.safeParse({
        password: "1234567890",
        confirm: "1234567890",
      }).success
    ).toBe(false);
  });

  it("rejects passwords shorter than PASSWORD_CREATE_MIN (10)", () => {
    expect(
      keystoreSetInputSchema.safeParse({ password: "123456789" }).success
    ).toBe(false);
  });

  it("rejects an 8-char password that used to satisfy the old floor", () => {
    // Regression guard for the PASSWORD_CREATE_MIN bump (8 -> 10): an
    // 8-char password must now be rejected for CREATING a new master
    // password, even though 8 chars is still accepted on the unlock path
    // (see secrets.test.ts regression guard in the other direction).
    expect(
      keystoreSetInputSchema.safeParse({ password: "12345678" }).success
    ).toBe(false);
  });
});

describe("keystoreSetResultSchema", () => {
  it("accepts kind:'set' and kind:'unchanged'", () => {
    expect(keystoreSetResultSchema.safeParse({ kind: "set" }).success).toBe(true);
    expect(
      keystoreSetResultSchema.safeParse({ kind: "unchanged" }).success
    ).toBe(true);
  });

  it("rejects unknown kinds + extra fields", () => {
    expect(
      keystoreSetResultSchema.safeParse({ kind: "rotated" }).success
    ).toBe(false);
    expect(
      keystoreSetResultSchema.safeParse({ kind: "set", extra: 1 }).success
    ).toBe(false);
  });
});

describe("wizardStateSchema (persisted)", () => {
  it("accepts the canonical defaults", () => {
    const r = wizardStateSchema.safeParse(defaultWizardState);
    expect(r.success).toBe(true);
  });

  it("rejects schemaVersion ≠ 2 to invalidate v1 persisted files", () => {
    expect(
      wizardStateSchema.safeParse({
        ...defaultWizardState,
        schemaVersion: 1 as 2,
      }).success
    ).toBe(false);
    expect(
      wizardStateSchema.safeParse({
        ...defaultWizardState,
        schemaVersion: 3 as 2,
      }).success
    ).toBe(false);
  });

  it("rejects duplicate completedSteps entries", () => {
    expect(
      wizardStateSchema.safeParse({
        schemaVersion: 2,
        currentStepId: "wallets",
        completedSteps: ["keystore", "keystore"],
        completed: false,
      }).success
    ).toBe(false);
  });

  it("rejects backward transition (currentStepId behind a completed step)", () => {
    // wallets is completed but currentStepId is keystore (idx 0 < idx 1)
    expect(
      wizardStateSchema.safeParse({
        schemaVersion: 2,
        currentStepId: "keystore",
        completedSteps: ["wallets"],
        completed: false,
      }).success
    ).toBe(false);
  });

  it("accepts forward transition (currentStepId == max completed + 1)", () => {
    expect(
      wizardStateSchema.safeParse({
        schemaVersion: 2,
        currentStepId: "wallets",
        completedSteps: ["keystore"],
        completed: false,
      }).success
    ).toBe(true);
  });

  it("accepts currentStepId AT the max completed (idempotent re-entry)", () => {
    expect(
      wizardStateSchema.safeParse({
        schemaVersion: 2,
        currentStepId: "keystore",
        completedSteps: ["keystore"],
        completed: false,
      }).success
    ).toBe(true);
  });

  // ── codex turn 6 RED: canonical-prefix + completed-consistent invariants ──

  it("rejects completedSteps with a gap (non-canonical-prefix)", () => {
    expect(
      wizardStateSchema.safeParse({
        schemaVersion: 2,
        currentStepId: "embedding",
        completedSteps: ["keystore", "apiKeys"],
        completed: false,
      }).success
    ).toBe(false);
  });

  it("rejects completedSteps starting from a non-zero step", () => {
    expect(
      wizardStateSchema.safeParse({
        schemaVersion: 2,
        currentStepId: "review",
        completedSteps: ["provider"],
        completed: false,
      }).success
    ).toBe(false);
  });

  it("rejects completed=true with currentStepId !== 'review'", () => {
    expect(
      wizardStateSchema.safeParse({
        schemaVersion: 2,
        currentStepId: "keystore",
        completedSteps: [],
        completed: true,
      }).success
    ).toBe(false);
  });

  it("rejects completed=true at review with missing prior steps", () => {
    expect(
      wizardStateSchema.safeParse({
        schemaVersion: 2,
        currentStepId: "review",
        completedSteps: ["keystore", "wallets"],
        completed: true,
      }).success
    ).toBe(false);
  });

  it("accepts completed=true at review with every prior step completed", () => {
    const priors = WIZARD_STEP_IDS.filter((id) => id !== "review");
    expect(
      wizardStateSchema.safeParse({
        schemaVersion: 2,
        currentStepId: "review",
        completedSteps: priors,
        completed: true,
      }).success
    ).toBe(true);
  });
});

describe("setWizardStateInputSchema (IPC boundary)", () => {
  it("accepts a forward transition without `completed`", () => {
    const r = setWizardStateInputSchema.safeParse({
      currentStepId: "wallets",
      completedSteps: ["keystore"],
    });
    expect(r.success).toBe(true);
  });

  it("accepts an explicit completed: true at review", () => {
    const priors = WIZARD_STEP_IDS.filter((id) => id !== "review");
    const r = setWizardStateInputSchema.safeParse({
      currentStepId: "review",
      completedSteps: priors,
      completed: true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown step id", () => {
    expect(
      setWizardStateInputSchema.safeParse({
        currentStepId: "zzz",
        completedSteps: [],
      }).success
    ).toBe(false);
  });

  it("rejects a backward transition", () => {
    expect(
      setWizardStateInputSchema.safeParse({
        currentStepId: "keystore",
        completedSteps: ["wallets"],
      }).success
    ).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    expect(
      setWizardStateInputSchema.safeParse({
        currentStepId: "wallets",
        completedSteps: ["keystore"],
        schemaVersion: 2,
      }).success
    ).toBe(false);
  });

  it("rejects completed=true at any step other than review", () => {
    expect(
      setWizardStateInputSchema.safeParse({
        currentStepId: "wallets",
        completedSteps: ["keystore"],
        completed: true,
      }).success
    ).toBe(false);
  });

  it("rejects gappy completedSteps on the IPC boundary too", () => {
    expect(
      setWizardStateInputSchema.safeParse({
        currentStepId: "embedding",
        completedSteps: ["keystore", "apiKeys"],
      }).success
    ).toBe(false);
  });
});
