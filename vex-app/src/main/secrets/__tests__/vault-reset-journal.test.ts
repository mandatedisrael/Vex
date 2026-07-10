import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readVaultResetJournal,
  vaultResetJournalSchema,
  writeVaultResetJournal,
} from "../vault-reset-journal.js";

let dir: string;
let journal: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vex-reset-journal-"));
  journal = path.join(dir, ".vault-reset-journal.json");
});

afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

describe("vault reset journal", () => {
  it("writes atomically with mode 0600 and validates on read", async () => {
    await writeVaultResetJournal({ version: 1, state: "requested" }, journal);
    expect(await readVaultResetJournal(journal)).toEqual({
      kind: "valid",
      journal: { version: 1, state: "requested" },
    });
    expect((await fs.stat(journal)).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("accepts only the two declared versioned states", () => {
    expect(vaultResetJournalSchema.safeParse({ version: 1, state: "failed" }).success).toBe(false);
    expect(vaultResetJournalSchema.safeParse({ version: 1, state: "requested", path: "/tmp/x" }).success).toBe(false);
    expect(vaultResetJournalSchema.safeParse({ version: 1, state: "backup-complete", backupDirName: "x" }).success).toBe(true);
  });

  it("distinguishes absent from corrupt journal", async () => {
    expect(await readVaultResetJournal(journal)).toEqual({ kind: "absent" });
    await fs.writeFile(journal, "{bad", "utf8");
    expect(await readVaultResetJournal(journal)).toEqual({ kind: "invalid" });
  });

  it("treats a journal access error as unknown even when no marker file exists", async () => {
    const directoryAtJournalPath = path.join(dir, "journal-as-directory");
    await fs.mkdir(directoryAtJournalPath);
    expect(await readVaultResetJournal(directoryAtJournalPath)).toEqual({ kind: "unknown" });
  });
});
