/**
 * Regression guard for the master-password CREATE-floor bump
 * (`PASSWORD_CREATE_MIN`, wizard.ts: 8 -> 10). `PASSWORD_MIN_LENGTH` here
 * governs re-entering an ALREADY-EXISTING master password — the unlock
 * screen and the private-key export re-auth flow — which must keep
 * accepting existing 8-char vaults. This file proves the wizard.ts
 * CREATE-floor change did not leak into this constant or its consumer
 * schemas.
 */

import { describe, expect, it } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  resetToFreshVaultInputSchema,
  resetToFreshVaultResultSchema,
  secretsUnlockInputSchema,
} from "../secrets.js";

describe("resetToFreshVault schemas", () => {
  it("accept only strict literal intent and scheduled output", () => {
    expect(resetToFreshVaultInputSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(resetToFreshVaultInputSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(resetToFreshVaultInputSchema.safeParse({ confirm: true, path: "/tmp/x" }).success).toBe(false);
    expect(resetToFreshVaultResultSchema.safeParse({ scheduled: true }).success).toBe(true);
    expect(resetToFreshVaultResultSchema.safeParse({ scheduled: true, path: "/tmp/x" }).success).toBe(false);
  });
});
import { walletExportPrivateKeyInputSchema } from "../wallets/export-private-key.js";

describe("PASSWORD_MIN_LENGTH (unlock / export re-auth floor)", () => {
  it("stays at 8, independent of PASSWORD_CREATE_MIN in wizard.ts", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });
});

describe("secretsUnlockInputSchema (unlock screen)", () => {
  it("still accepts an 8-char password", () => {
    expect(
      secretsUnlockInputSchema.safeParse({ password: "12345678" }).success
    ).toBe(true);
  });

  it("still rejects a 7-char password", () => {
    expect(
      secretsUnlockInputSchema.safeParse({ password: "1234567" }).success
    ).toBe(false);
  });
});

describe("walletExportPrivateKeyInputSchema (private-key export re-auth)", () => {
  it("still accepts an 8-char password", () => {
    expect(
      walletExportPrivateKeyInputSchema.safeParse({
        chain: "evm",
        walletId: "wallet-1",
        password: "12345678",
        riskAcknowledged: true,
      }).success
    ).toBe(true);
  });

  it("still rejects a 7-char password", () => {
    expect(
      walletExportPrivateKeyInputSchema.safeParse({
        chain: "evm",
        walletId: "wallet-1",
        password: "1234567",
        riskAcknowledged: true,
      }).success
    ).toBe(false);
  });
});
