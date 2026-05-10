/**
 * Wizard state store — atomic read-modify-write to
 * `${ELECTRON_STATE_DIR}/wizard-state.json`.
 *
 * Mirrors the `PreferencesStore` pattern (`src/main/preferences/store.ts`):
 * a single in-process operation chain serialises load + write + update
 * so concurrent IPC invocations cannot lose each other's intermediate
 * state. Each write uses a unique tmp suffix (pid + counter + random)
 * so leftover-file collisions cannot occur even across crashes.
 *
 * Lives under `ELECTRON_STATE_DIR` (the Electron-private nested path)
 * deliberately — vex-shell does not need to read or write wizard
 * progress, only the env values the steps emit (those land in the
 * shared `${CONFIG_DIR}/.env`).
 *
 * The persisted shape is validated by `wizardStateSchema`, which
 * rejects: unknown step ids, duplicate completed entries, and
 * backward-step transitions (currentStepId behind a completed step).
 * On corrupt JSON or schema rejection we recover by writing the
 * defaults — the wizard simply starts over from Step 1, which the
 * envState skip-badge layer turns into a one-click pass when the
 * underlying env vars are still present.
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  defaultWizardState,
  wizardStateSchema,
  type SetWizardStateInput,
  type WizardState,
} from "@shared/schemas/wizard.js";
import { ELECTRON_STATE_DIR } from "../paths/config-dir.js";

export interface WizardStateStoreOptions {
  /** Override the storage path for tests; production callers omit this. */
  readonly filePath?: string;
}

export class WizardStateStore {
  private cache: WizardState | null = null;
  private chain: Promise<void> = Promise.resolve();
  private writeCounter = 0;
  private readonly filePath: string;

  constructor(options: WizardStateStoreOptions = {}) {
    this.filePath =
      options.filePath ?? path.join(ELECTRON_STATE_DIR, "wizard-state.json");
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    let resolved!: (value: T) => void;
    let rejected!: (reason: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolved = res;
      rejected = rej;
    });
    const next = this.chain.then(
      async () => {
        try {
          resolved(await task());
        } catch (e) {
          rejected(e);
        }
      },
      async () => {
        try {
          resolved(await task());
        } catch (e) {
          rejected(e);
        }
      }
    );
    this.chain = next.catch(() => undefined);
    return result;
  }

  load(): Promise<WizardState> {
    return this.enqueue(async () => this.loadInner());
  }

  private async loadInner(): Promise<WizardState> {
    if (this.cache) return this.cache;
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        await this.writeInner(defaultWizardState);
        return defaultWizardState;
      }
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.writeInner(defaultWizardState);
      return defaultWizardState;
    }
    const result = wizardStateSchema.safeParse(parsed);
    if (!result.success) {
      await this.writeInner(defaultWizardState);
      return defaultWizardState;
    }
    this.cache = result.data;
    return this.cache;
  }

  /**
   * Apply an IPC `setWizardState` patch. The merge preserves
   * `schemaVersion` (the store owns versioning) and lets the caller
   * leave `completed` untouched (defaults to the current value). The
   * merged shape is re-validated through `wizardStateSchema` so any
   * caller-side bypass of the input refines is still caught here.
   */
  update(input: SetWizardStateInput): Promise<WizardState> {
    return this.enqueue(async () => {
      const current = await this.loadInner();
      const next = wizardStateSchema.parse({
        schemaVersion: 1,
        currentStepId: input.currentStepId,
        completedSteps: input.completedSteps,
        completed: input.completed ?? current.completed,
      });
      await this.writeInner(next);
      return next;
    });
  }

  /** Test-only — production callers do not use this. */
  resetForTests(): void {
    this.cache = null;
  }

  private async writeInner(state: WizardState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    this.writeCounter += 1;
    const suffix = `${process.pid}.${this.writeCounter}.${crypto.randomBytes(4).toString("hex")}`;
    const tmp = `${this.filePath}.${suffix}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), {
        mode: 0o600,
        encoding: "utf8",
      });
      await fs.rename(tmp, this.filePath);
      this.cache = state;
    } catch (e) {
      await fs.unlink(tmp).catch(() => undefined);
      throw e;
    }
  }
}

export const wizardStateStore = new WizardStateStore();
