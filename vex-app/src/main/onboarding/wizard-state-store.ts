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
 * deliberately — setup progress is desktop UI state, while the env values
 * the steps emit land in the shared `${CONFIG_DIR}/.env`.
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

/**
 * Provenance of the in-memory cache + a persistent sidecar marker on
 * disk (codex review round 4/5 RED). `loadInner` writes both the
 * defaults file AND the sidecar when it recovers from a missing or
 * corrupt state file; `peekCompleted` refuses to trust either the
 * cache or the disk state as long as the sidecar exists, so the
 * destructive-recovery guard stays fail-safe even after a process
 * restart. `update()` deletes the sidecar on the first authoritative
 * write so the wizard's normal progression unblocks the guard.
 */
type CacheProvenance = "persisted" | "recovered";

const RECOVERY_MARKER_SUFFIX = ".recovered";

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return (
    e instanceof Error &&
    "code" in e &&
    typeof e.code === "string"
  );
}

export class WizardStateStore {
  private cache: WizardState | null = null;
  private cacheProvenance: CacheProvenance | null = null;
  private chain: Promise<void> = Promise.resolve();
  private writeCounter = 0;
  private readonly filePath: string;
  private readonly recoveryMarkerPath: string;

  constructor(options: WizardStateStoreOptions = {}) {
    this.filePath =
      options.filePath ?? path.join(ELECTRON_STATE_DIR, "wizard-state.json");
    this.recoveryMarkerPath = `${this.filePath}${RECOVERY_MARKER_SUFFIX}`;
  }

  /**
   * Returns true iff the sidecar was successfully recorded. The
   * destructive-recovery guard relies on this — `loadInner` writes
   * the defaults file ONLY when this returns true, so a failed
   * marker write never produces an authoritative-looking
   * `completed: false` file on disk (codex review round 6 RED #2).
   */
  private async markRecovery(): Promise<boolean> {
    try {
      await fs.mkdir(path.dirname(this.recoveryMarkerPath), {
        recursive: true,
      });
      await fs.writeFile(this.recoveryMarkerPath, "", {
        mode: 0o600,
        encoding: "utf8",
      });
      return true;
    } catch {
      return false;
    }
  }

  private async clearRecoveryMarker(): Promise<void> {
    try {
      await fs.unlink(this.recoveryMarkerPath);
    } catch {
      // ENOENT (no marker) is the common case; ignore.
    }
  }

  /**
   * Returns:
   *   - "present"  → sidecar exists; defaults the caller into fail-safe
   *   - "absent"   → sidecar confirmed missing (ENOENT)
   *   - "unknown"  → access failed for any other reason (EACCES, EIO)
   *                  → caller MUST treat as fail-safe (codex review
   *                  round 6 RED #3 — only ENOENT proves absence).
   */
  private async hasRecoveryMarker(): Promise<
    "present" | "absent" | "unknown"
  > {
    try {
      await fs.access(this.recoveryMarkerPath);
      return "present";
    } catch (e) {
      if (isErrnoException(e) && e.code === "ENOENT") return "absent";
      return "unknown";
    }
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

  /**
   * Non-mutating read of the `completed` flag for write-protection
   * guards (M11.5.4 — `clearStaleSecretCache` uses this to refuse
   * destructive recovery after setup finished). Returns:
   *   - `true`  → wizard.completed is explicitly `true` (persisted by
   *               user-driven `update()` or read from a valid file)
   *   - `false` → wizard.completed is explicitly `false`
   *   - `null`  → state is unknown / unauthoritative (file missing,
   *               unreadable, corrupt, schema-invalid, OR present in
   *               the in-memory cache only because `load()` had to
   *               auto-recover defaults)
   *
   * Critically:
   *   - This does NOT write defaults to disk (unlike `load()`).
   *   - It does NOT trust a `recovered` cache (codex review round 4
   *     RED — `load()` writes defaults on missing/corrupt files and
   *     would otherwise turn that into a false `completed:false`
   *     report, defeating the destructive-recovery guard).
   */
  async peekCompleted(): Promise<boolean | null> {
    // Codex review round 6 RED #1 — serialize through the same chain
    // as `load()` / `update()` so a concurrent recovery cannot leave
    // a valid-looking defaults file on disk while this peek is in the
    // middle of its check.
    return this.enqueue(async () => this.peekCompletedInner());
  }

  private async peekCompletedInner(): Promise<boolean | null> {
    // Cross-process fail-safe: a sidecar marker on disk means the
    // last `loadInner` had to recover defaults. Even after a process
    // restart, the file content is just the defaults blob — not
    // authoritative state. Return null until an `update()` clears
    // the marker. Any non-ENOENT error checking the marker also
    // forces fail-safe (codex review round 6 RED #3).
    const markerState = await this.hasRecoveryMarker();
    if (markerState !== "absent") return null;
    // In-process fast path: a persisted cache is the source of truth
    // for the current process.
    if (this.cache !== null && this.cacheProvenance === "persisted") {
      return this.cache.completed;
    }
    // No cache for this process yet — re-read the file raw, without
    // going through loadInner (which would write defaults again on a
    // missing file and create a side effect peekCompleted promises
    // not to cause).
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = wizardStateSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data.completed;
  }

  /**
   * Codex review round 6 RED #2 — marker MUST land before the
   * defaults file so a process that crashes between the two writes
   * (or a marker IO failure) never leaves an authoritative-looking
   * `completed: false` blob on disk. If marker write fails we keep
   * the recovered state in memory only and skip the disk write; the
   * next `update()` will create a real authoritative file.
   */
  private async recoverDefaults(): Promise<WizardState> {
    const markerOk = await this.markRecovery();
    if (markerOk) {
      await this.writeInner(defaultWizardState);
    } else {
      // Marker IO failed — do NOT write defaults to disk. The next
      // process to read would otherwise see a valid file with no
      // marker and treat it as authoritative.
      this.cache = defaultWizardState;
    }
    this.cacheProvenance = "recovered";
    return defaultWizardState;
  }

  private async loadInner(): Promise<WizardState> {
    if (this.cache) return this.cache;
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (e: unknown) {
      if (isErrnoException(e) && e.code === "ENOENT") {
        return this.recoverDefaults();
      }
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.recoverDefaults();
    }
    const result = wizardStateSchema.safeParse(parsed);
    if (!result.success) {
      return this.recoverDefaults();
    }
    this.cache = result.data;
    this.cacheProvenance = "persisted";
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
        schemaVersion: 2,
        currentStepId: input.currentStepId,
        completedSteps: input.completedSteps,
        completed: input.completed ?? current.completed,
      });
      await this.writeInner(next);
      // User-driven update upgrades cache provenance to "persisted"
      // and clears the sidecar recovery marker so cross-process
      // peekCompleted starts trusting disk state again.
      this.cacheProvenance = "persisted";
      await this.clearRecoveryMarker();
      return next;
    });
  }

  /** Production reset used only after a verified fresh-vault archive. */
  resetForFreshVault(): Promise<WizardState> {
    return this.enqueue(async () => {
      await this.writeInner(defaultWizardState);
      this.cacheProvenance = "persisted";
      await this.clearRecoveryMarker();
      return defaultWizardState;
    });
  }

  /** Test-only — production callers do not use this. */
  resetForTests(): void {
    this.cache = null;
    this.cacheProvenance = null;
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
