/**
 * Knowledge & Memory management panel (stage 7-2a) — a read-only AppShell
 * sub-view (mirrors SettingsPanel). Three sections:
 *
 *  1. **Knowledge** — the GLOBAL knowledge store (all sources/statuses,
 *     visibly labeled), with a status filter + client-side text search.
 *  2. **Session memory** — the active session's memories (theme +
 *     outstanding COUNTS + importance/confidence); gated on an active
 *     session.
 *  3. **Compaction history** — the active session's compaction-generation
 *     timeline; gated on an active session.
 *
 * Read-only: no disable/archive here (knowledge mutation lands in 7-2b).
 * Every value is the sanitized DTO from main — never raw narrative bodies,
 * outstanding-item text, or embeddings. Session-scoped sections show a clear
 * empty state when no session is active (and issue no session-scoped query).
 */

import { useState, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import type { KnowledgeEntryDto, KnowledgeStatusDto } from "@shared/schemas/knowledge.js";
import type { SessionMemoryDto, MemoryStatsDto } from "@shared/schemas/memory.js";
import type { CompactionHistoryItem } from "@shared/schemas/compaction.js";
import { Button } from "../../components/ui/button.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useKnowledgeList } from "../../lib/api/knowledge.js";
import { useMemoryStats, useSessionMemories } from "../../lib/api/memory.js";
import { useCompactionHistory } from "../../lib/api/compaction.js";

const SECTION =
  "flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4";
const PILL =
  "inline-flex items-center rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-secondary)]";

export function KnowledgePanel(): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const activeSessionId = useUiStore((s) => s.activeSessionId);

  return (
    <div
      data-vex-screen="knowledge"
      className="flex h-full min-h-0 flex-col text-foreground"
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.045] px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAppShellView("session")}
          aria-label="Back to chat"
          className="text-[var(--color-text-secondary)] hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden />
          <span>Back</span>
        </Button>
        <h1 className="text-sm font-semibold tracking-tight">
          Knowledge &amp; Memory
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
          <KnowledgeSection />
          <MemorySection sessionId={activeSessionId} />
          <CompactionHistorySection sessionId={activeSessionId} />
        </div>
      </div>
    </div>
  );
}

// ── states ───────────────────────────────────────────────────────────────

function Loading({ label }: { readonly label: string }): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
    >
      {label}
    </div>
  );
}

function ErrorState({ message }: { readonly message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      {message}
    </div>
  );
}

function Empty({ label }: { readonly label: string }): JSX.Element {
  return (
    <p className="px-1 py-2 text-xs text-[var(--color-text-muted)]">{label}</p>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// ── 1. Knowledge (global) ──────────────────────────────────────────────────

const KNOWLEDGE_FILTERS: ReadonlyArray<{
  readonly value: KnowledgeStatusDto | "all";
  readonly label: string;
}> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "invalidated", label: "Invalidated" },
  { value: "superseded", label: "Superseded" },
];

function KnowledgeSection(): JSX.Element {
  const [status, setStatus] = useState<KnowledgeStatusDto | "all">("all");
  const [search, setSearch] = useState("");
  const query = useKnowledgeList(status === "all" ? undefined : status);

  return (
    <section data-vex-section="knowledge" className={SECTION}>
      <div>
        <h2 className="text-sm font-semibold">Knowledge</h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Durable lessons the agent has learned (global, all sessions). Sources
          and statuses are shown so low-confidence entries are visible but
          labeled.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {KNOWLEDGE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatus(f.value)}
            data-active={status === f.value}
            className={`rounded-md px-2 py-1 text-[11px] ${
              status === f.value
                ? "bg-white/[0.12] text-foreground"
                : "bg-white/[0.04] text-[var(--color-text-secondary)] hover:bg-white/[0.08]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title / summary / kind"
          aria-label="Search knowledge"
          className="ml-auto min-w-[160px] flex-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-foreground placeholder:text-[var(--color-text-muted)]"
        />
      </div>

      <KnowledgeList query={query} search={search} />
    </section>
  );
}

function KnowledgeList({
  query,
  search,
}: {
  readonly query: ReturnType<typeof useKnowledgeList>;
  readonly search: string;
}): JSX.Element {
  if (query.isLoading) return <Loading label="Loading knowledge…" />;
  const res = query.data;
  if (res === undefined || !res.ok) {
    return (
      <ErrorState
        message={res && !res.ok ? res.error.message : "Unable to load knowledge."}
      />
    );
  }
  const needle = search.trim().toLowerCase();
  const items =
    needle.length === 0
      ? res.data
      : res.data.filter(
          (k) =>
            k.title.toLowerCase().includes(needle) ||
            k.summary.toLowerCase().includes(needle) ||
            k.kind.toLowerCase().includes(needle),
        );
  if (items.length === 0) {
    return <Empty label="No knowledge entries match." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((k) => (
        <KnowledgeRow key={k.id} entry={k} />
      ))}
    </ul>
  );
}

function KnowledgeRow({ entry }: { readonly entry: KnowledgeEntryDto }): JSX.Element {
  return (
    <li
      data-vex-knowledge-id={entry.id}
      data-status={entry.status}
      className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-xs font-medium text-foreground">
          {entry.title}
        </span>
        <span className={PILL}>{entry.kind}</span>
        <span className={PILL} data-vex-knowledge-status>
          {entry.status}
        </span>
        {entry.source !== null ? <span className={PILL}>{entry.source}</span> : null}
        {entry.confidence !== null ? (
          <span className={PILL}>conf {entry.confidence.toFixed(2)}</span>
        ) : null}
        <span
          data-vex-created
          title={entry.createdAt}
          className="ml-auto text-[10px] text-[var(--color-text-muted)]"
        >
          {fmtDate(entry.createdAt)}
        </span>
      </div>
      {entry.summary.length > 0 ? (
        <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text-secondary)]">
          {entry.summary}
        </p>
      ) : null}
      {entry.tags.length > 0 || entry.sourceSession !== null ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {entry.tags.map((t) => (
            <span
              key={t}
              className="rounded bg-white/[0.05] px-1 py-0.5 text-[10px] text-[var(--color-text-muted)]"
            >
              #{t}
            </span>
          ))}
          {entry.sourceSession !== null ? (
            <span
              className="text-[10px] text-[var(--color-text-muted)]"
              title={entry.sourceSession}
            >
              src {entry.sourceSession.slice(0, 8)}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ── 2. Session memory ──────────────────────────────────────────────────────

function MemorySection({
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

// ── 3. Compaction history ──────────────────────────────────────────────────

function CompactionHistorySection({
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
