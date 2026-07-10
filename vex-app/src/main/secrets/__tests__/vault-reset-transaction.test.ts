import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupManifestV2 } from "@vex-lib/wallet-backup.js";
import {
  runVaultResetTransaction,
  type VaultResetTransactionDeps,
} from "../vault-reset-transaction.js";

let root: string;
let configDir: string;
let backupsDir: string;
let archiveDir: string;
let journalFile: string;
let configFile: string;
let envFile: string;
let vaultFile: string;
let markerFile: string;
let keystoreFile: string;
let unknownWallet: string;
let manifest: BackupManifestV2;
let journalState: VaultResetTransactionDeps extends { readJournal: () => Promise<infer R> } ? R : never;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vex-reset-tx-"));
  configDir = path.join(root, "config");
  backupsDir = path.join(configDir, "backups");
  archiveDir = path.join(backupsDir, "vault-reset-2026-07-10T010203000Z");
  journalFile = path.join(configDir, ".vault-reset-journal.json");
  configFile = path.join(configDir, "config.json");
  envFile = path.join(configDir, ".env");
  vaultFile = path.join(configDir, "secrets.vault.json");
  markerFile = path.join(configDir, ".setup-complete");
  keystoreFile = path.join(configDir, "wallet-evm_11111111-1111-4111-8111-111111111111.json");
  unknownWallet = path.join(configDir, "wallet-unknown.json");
  await fs.mkdir(archiveDir, { recursive: true });
  const files = [
    [keystoreFile, "wallet-evm_11111111-1111-4111-8111-111111111111.json", "wallet-evm"],
    [configFile, "config.json", "config"],
    [envFile, ".env", "env"],
    [vaultFile, "secrets.vault.json", "vault"],
  ] as const;
  for (const [live, filename] of files) {
    await fs.writeFile(live, `bytes:${filename}`);
    await fs.writeFile(path.join(archiveDir, filename), `bytes:${filename}`);
  }
  await fs.writeFile(markerFile, "done");
  await fs.writeFile(unknownWallet, "unknown");
  manifest = {
    version: 2,
    cliVersion: "test",
    createdAt: "2026-07-10T01:02:03.000Z",
    wallets: [],
    files: files.map(([, filename, role]) => ({
      filename,
      role,
      ...(role === "wallet-evm" ? { walletId: "owned", walletFamily: "evm" as const } : {}),
    })),
    purpose: "vault-reset",
  };
  journalState = {
    kind: "valid",
    journal: { version: 1, state: "backup-complete", backupDirName: path.basename(archiveDir) },
  };
});

afterEach(async () => fs.rm(root, { recursive: true, force: true }));

function deps(overrides: Partial<VaultResetTransactionDeps> = {}): VaultResetTransactionDeps {
  return {
    configDir,
    backupsDir,
    configFile,
    envFile,
    vaultFile,
    setupCompleteFile: markerFile,
    journalFile,
    readJournal: async () => journalState,
    writeJournal: async (journal) => {
      journalState = { kind: "valid", journal };
    },
    clearJournal: vi.fn(async () => {
      journalState = { kind: "absent" };
    }),
    createBackup: vi.fn(async () => archiveDir),
    readManifest: () => manifest,
    resetWizard: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("vault reset boot transaction", () => {
  it("is a no-op only when journal absence is proven", async () => {
    journalState = { kind: "absent" };
    expect(await runVaultResetTransaction(deps())).toBe("no-op");
  });

  it.each(["unknown", "invalid"] as const)("%s journal is unsafe and deletes nothing", async (kind) => {
    journalState = { kind };
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
    expect(await fs.readFile(markerFile, "utf8")).toBe("done");
  });

  it("backup failure stays requested and performs zero deletions", async () => {
    journalState = { kind: "valid", journal: { version: 1, state: "requested" } };
    const d = deps({ createBackup: vi.fn(async () => null) });
    expect(await runVaultResetTransaction(d)).toBe("recoverable-request-failure");
    expect(journalState).toEqual({ kind: "valid", journal: { version: 1, state: "requested" } });
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
  });

  it("removes manifest-owned files plus the D-D .setup-complete derived-state exception, vault last, then clears journal", async () => {
    const order: string[] = [];
    const d = deps({
      afterStep: (step) => order.push(step),
      resetWizard: vi.fn(async () => {
        order.push("wizard-api");
      }),
      clearJournal: vi.fn(async () => {
        order.push("clear-api");
      }),
    });
    expect(await runVaultResetTransaction(d)).toBe("completed");
    for (const file of [keystoreFile, configFile, envFile, markerFile, vaultFile]) {
      await expect(fs.access(file)).rejects.toThrow();
    }
    expect(await fs.readFile(unknownWallet, "utf8")).toBe("unknown");
    expect(order.indexOf("vault")).toBeGreaterThan(order.indexOf("setup-marker"));
    expect(order.indexOf("clear-api")).toBeGreaterThan(order.indexOf("wizard-api"));
  });

  it.each([
    ["keystore", () => keystoreFile],
    ["config", () => configFile],
    ["env", () => envFile],
    ["vault", () => vaultFile],
  ] as const)("modified %s preimage stops before that unlink and all later removals", async (_name, target) => {
    await fs.writeFile(target(), "externally-modified");
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(target(), "utf8")).toBe("externally-modified");
    expect(await fs.readFile(vaultFile, "utf8")).toBe(
      target() === vaultFile ? "externally-modified" : "bytes:secrets.vault.json",
    );
  });

  it.each(["wallet-evm_11111111-1111-4111-8111-111111111111.json", "config.json", ".env", "secrets.vault.json"])(
    "missing live %s is skipped idempotently",
    async (filename) => {
      await fs.unlink(path.join(configDir, filename));
      expect(await runVaultResetTransaction(deps())).toBe("completed");
      await expect(fs.access(vaultFile)).rejects.toThrow();
    },
  );

  it("unreadable/non-file live preimage stops safely", async () => {
    await fs.unlink(configFile);
    await fs.mkdir(configFile);
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
  });

  it.each([
    "../vault-reset-2026-07-10T010203Z",
    "ordinary-archive",
    "vault-reset-2026-07-10T010203Z/child",
  ])("rejects unsafe or noncanonical backupDirName %s", async (backupDirName) => {
    journalState = { kind: "valid", journal: { version: 1, state: "backup-complete", backupDirName } };
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
  });

  it("refuses an ordinary manifest even when every byte matches", async () => {
    manifest = { ...manifest, purpose: "ordinary" };
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(keystoreFile, "utf8")).toContain("wallet-evm");
  });

  it("re-entry refuses a missing archive before further deletion", async () => {
    await fs.rm(archiveDir, { recursive: true, force: true });
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
  });

  it("re-entry refuses a missing archived file before any deletion", async () => {
    await fs.unlink(path.join(archiveDir, ".env"));
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(keystoreFile, "utf8")).toContain("wallet-evm");
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
  });

  it("re-entry refuses a corrupt manifest before any deletion", async () => {
    expect(
      await runVaultResetTransaction(
        deps({
          readManifest: () => {
            throw new Error("corrupt manifest");
          },
        }),
      ),
    ).toBe("unsafe-recovery-state");
    expect(await fs.readFile(keystoreFile, "utf8")).toContain("wallet-evm");
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
  });

  it("rejects a canonical-name symlink whose realpath escapes BACKUPS_DIR", async () => {
    const outside = path.join(root, "outside-archive");
    await fs.rename(archiveDir, outside);
    await fs.symlink(
      outside,
      archiveDir,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
  });

  it("a backward-compatible manifest without purpose defaults cannot authorize reset", async () => {
    const withoutPurpose = { ...manifest } as Record<string, unknown>;
    delete withoutPurpose.purpose;
    expect(await runVaultResetTransaction(deps({ readManifest: () => withoutPurpose }))).toBe(
      "unsafe-recovery-state",
    );
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
  });

  it.each([
    "backup-complete",
    "wallet-keystore",
    "config",
    "env",
    "setup-marker",
    "vault",
    "wizard",
    "journal-cleared",
  ] as const)("resumes safely after a crash at %s", async (crashStep) => {
    if (crashStep === "backup-complete") {
      journalState = { kind: "valid", journal: { version: 1, state: "requested" } };
    }
    let crashArmed = true;
    const crashing = deps({
      afterStep: (step) => {
        if (crashArmed && step === crashStep) {
          crashArmed = false;
          throw new Error("simulated process crash");
        }
      },
    });
    await runVaultResetTransaction(crashing).catch(() => "crashed");
    const resumed = await runVaultResetTransaction(deps());
    expect(["completed", "no-op"]).toContain(resumed);
    expect(await fs.readFile(unknownWallet, "utf8")).toBe("unknown");
    await expect(fs.access(vaultFile)).rejects.toThrow();
  });

  it("a swapped config cannot redirect the manifest-owned deletion set", async () => {
    await fs.writeFile(configFile, "different config naming wallet-unknown.json");
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(unknownWallet, "utf8")).toBe("unknown");
  });

  it("refuses a valid basename whose manifest role could target unrelated config state", async () => {
    manifest = {
      ...manifest,
      files: manifest.files.map((entry) =>
        entry.role === "wallet-evm" ? { ...entry, filename: ".install-id" } : entry,
      ),
    };
    await fs.writeFile(path.join(archiveDir, ".install-id"), "install-id");
    expect(await runVaultResetTransaction(deps())).toBe("unsafe-recovery-state");
    expect(await fs.readFile(vaultFile, "utf8")).toContain("vault");
  });
});
