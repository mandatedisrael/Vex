/**
 * Session-memory section of the Knowledge & Memory panel (7-2a).
 *
 * The active session's memories — theme + outstanding work as COUNTS +
 * importance/confidence — gated on an active session. Read-only; every value
 * is the sanitized DTO from main (never raw outstanding-item text/embeddings).
 */

import type { JSX } from "react";
import type { MemoryStatsDto, SessionMemoryDto } from "@shared/schemas/memory.js";
import { useMemoryStats, useSessionMemories } from "../../lib/api/memory.js";
import {
  Empty,
  ErrorState,
  Loading,
  PILL,
  SECTION,
  fmtDate,
} from "./KnowledgePanelShared.js";

export function MemorySection({
  sessionId,
}: {
  readonly sessionId: string | null;
}): JSX.Element {
  const statsQuery = useMemoryStats(sessionId);
  const listQuery = useSessionMemories(sessionId);

  return (
    <section data-vex-section="memory" className={SECTION}>
      <div>
        <h2 className="text-sm font-semibold">Session memory</h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          What the agent remembers from this session (read-only). Outstanding
          work is shown as counts.
        </p>
      </div>
      {sessionId === null || sessionId.length === 0 ? (
        <Empty label="Open a session to view its memory." />
      ) : (
        <>
          <MemoryStatsRow query={statsQuery} />
          <MemoryList query={listQuery} />
        </>
      )}
    </section>
  );
}

function MemoryStatsRow({
  query,
}: {
  readonly query: ReturnType<typeof useMemoryStats>;
}): JSX.Element | null {
  if (query.isLoading) return <Loading label="Loading memory stats…" />;
  const res = query.data;
  if (res === undefined || !res.ok) return null; // list below surfaces errors
  const stats: MemoryStatsDto | null = res.data;
  if (stats === null) return null;
  return (
    <div
      data-vex-memory-stats
      className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-secondary)]"
    >
      <span className={PILL}>{stats.activeCount} memories</span>
      <span className={PILL}>gen {stats.compactCount}</span>
      <span className={PILL}>{stats.unresolvedOutstandingCount} open items</span>
      {stats.recentThemes.slice(0, 5).map((t) => (
        <span key={t} className={PILL}>
          {t}
        </span>
      ))}
    </div>
  );
}

function MemoryList({
  query,
}: {
  readonly query: ReturnType<typeof useSessionMemories>;
}): JSX.Element {
  if (query.isLoading) return <Loading label="Loading memories…" />;
  const res = query.data;
  if (res === undefined || !res.ok) {
    return (
      <ErrorState
        message={res && !res.ok ? res.error.message : "Unable to load memory."}
      />
    );
  }
  if (res.data === null) {
    return <Empty label="This session has no memory yet." />;
  }
  if (res.data.length === 0) {
    return <Empty label="No memories recorded for this session yet." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {res.data.map((m) => (
        <MemoryRow key={m.id} memory={m} />
      ))}
    </ul>
  );
}

function MemoryRow({ memory }: { readonly memory: SessionMemoryDto }): JSX.Element {
  return (
    <li
      data-vex-memory-id={memory.id}
      className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-xs font-medium text-foreground">
          {memory.theme}
        </span>
        <span className={PILL}>{memory.status}</span>
        <span className={PILL}>gen {memory.checkpointGeneration}</span>
        {memory.importance !== null ? (
          <span className={PILL}>imp {memory.importance}</span>
        ) : null}
        {memory.confidence !== null ? (
          <span className={PILL}>conf {memory.confidence.toFixed(2)}</span>
        ) : null}
        <span className={PILL}>
          {memory.outstandingOpenCount} open / {memory.outstandingResolvedCount}{" "}
          done
        </span>
        <span
          data-vex-created
          title={memory.createdAt}
          className="ml-auto text-[10px] text-[var(--color-text-muted)]"
        >
          {fmtDate(memory.createdAt)}
        </span>
      </div>
    </li>
  );
}
