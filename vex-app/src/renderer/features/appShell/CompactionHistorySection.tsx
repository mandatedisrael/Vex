/**
 * Compaction-history section of the Knowledge & Memory panel (7-2a).
 *
 * The active session's compaction-generation timeline — when older messages
 * were compacted into memory — gated on an active session. Read-only.
 */

import type { JSX } from "react";
import type { CompactionHistoryItem } from "@shared/schemas/compaction.js";
import { useCompactionHistory } from "../../lib/api/compaction.js";
import {
  Empty,
  ErrorState,
  Loading,
  PILL,
  SECTION,
  fmtDate,
} from "./KnowledgePanelShared.js";

export function CompactionHistorySection({
  sessionId,
}: {
  readonly sessionId: string | null;
}): JSX.Element {
  const query = useCompactionHistory(sessionId);
  return (
    <section data-vex-section="compaction-history" className={SECTION}>
      <div>
        <h2 className="text-sm font-semibold">Compaction history</h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          When this session&apos;s older messages were compacted into memory.
        </p>
      </div>
      {sessionId === null || sessionId.length === 0 ? (
        <Empty label="Open a session to view its compaction history." />
      ) : (
        <CompactionHistoryList query={query} />
      )}
    </section>
  );
}

function CompactionHistoryList({
  query,
}: {
  readonly query: ReturnType<typeof useCompactionHistory>;
}): JSX.Element {
  if (query.isLoading) return <Loading label="Loading compaction history…" />;
  const res = query.data;
  if (res === undefined || !res.ok) {
    return (
      <ErrorState
        message={
          res && !res.ok ? res.error.message : "Unable to load compaction history."
        }
      />
    );
  }
  if (res.data === null) {
    return <Empty label="No compaction history for this session." />;
  }
  if (res.data.length === 0) {
    return <Empty label="No compactions have run for this session yet." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {res.data.map((h) => (
        <CompactionRow key={h.checkpointGeneration} item={h} />
      ))}
    </ul>
  );
}

function CompactionRow({
  item,
}: {
  readonly item: CompactionHistoryItem;
}): JSX.Element {
  const range =
    item.sourceStartMessageId !== null && item.sourceEndMessageId !== null
      ? `#${item.sourceStartMessageId}–#${item.sourceEndMessageId}`
      : item.sourceEndMessageId !== null
        ? `…#${item.sourceEndMessageId}`
        : "—";
  return (
    <li
      data-vex-compaction-generation={item.checkpointGeneration}
      data-status={item.status}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
    >
      <span className={PILL}>gen {item.checkpointGeneration}</span>
      <span className={PILL}>{item.status}</span>
      <span className={PILL}>msgs {range}</span>
      <span className={PILL}>{item.chunksInserted} chunks</span>
      <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
        {fmtDate(item.completedAt ?? item.createdAt)}
      </span>
    </li>
  );
}
