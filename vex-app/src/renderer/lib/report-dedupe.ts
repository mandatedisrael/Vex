/**
 * Renderer-side dedupe for automatic bug-report emissions.
 *
 * Use case: a render loop or a thrown effect can fire `onCaughtError` /
 * `onUncaughtError` / `unhandledrejection` many times in quick succession.
 * Without dedupe we'd spam `bug_reports` with rows that all describe the
 * same root cause.
 *
 * Strategy: keep an in-memory `Map<key, lastTimestamp>` keyed by
 * `category + ":" + key`. Drop emits whose previous timestamp is within
 * `windowMs`. The map is bounded by `maxEntries` (LRU-by-insertion) so a
 * truly unbounded source can't grow the renderer heap.
 *
 * NOT a rate limiter for adversarial input — the renderer is untrusted in
 * principle, but its emit pipe is bounded by the preload schema and the
 * main-side handler. This module exists to reduce noise, not to enforce
 * a security invariant.
 */

const DEFAULT_WINDOW_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 256;

export interface DedupeKey {
  readonly category: string;
  readonly key: string;
}

export interface DedupeConfig {
  readonly windowMs?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export interface ReportDedupe {
  shouldDrop(input: DedupeKey): boolean;
  reset(): void;
  size(): number;
}

export function createReportDedupe(config: DedupeConfig = {}): ReportDedupe {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = config.now ?? (() => Date.now());
  const entries = new Map<string, number>();

  function evictIfNeeded(): void {
    if (entries.size <= maxEntries) return;
    // Map iteration order = insertion order. Drop the oldest.
    const firstKey = entries.keys().next().value;
    if (firstKey !== undefined) {
      entries.delete(firstKey);
    }
  }

  return {
    shouldDrop({ category, key }: DedupeKey): boolean {
      const compoundKey = `${category}:${key}`;
      const t = now();
      const last = entries.get(compoundKey);
      if (last !== undefined && t - last < windowMs) {
        return true;
      }
      // Re-insert at the tail so the LRU eviction is sensible.
      entries.delete(compoundKey);
      entries.set(compoundKey, t);
      evictIfNeeded();
      return false;
    },
    reset(): void {
      entries.clear();
    },
    size(): number {
      return entries.size;
    },
  };
}

/**
 * Module-level singleton — renderer wires it from `main.tsx` and the
 * `ReportIssueDialog` for manual submissions does NOT use it (manual
 * submissions are never dropped).
 */
export const rendererReportDedupe: ReportDedupe = createReportDedupe();
