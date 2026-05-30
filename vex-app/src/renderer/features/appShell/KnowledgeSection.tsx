/**
 * Knowledge section of the Knowledge & Memory panel.
 *
 * The GLOBAL knowledge store (all sources/statuses, visibly labeled) with a
 * status filter + client-side text search (7-2a), plus archive/invalidate of
 * ACTIVE entries through a destructive, one-way confirm (7-2b). Every value is
 * the sanitized DTO from main — never raw narrative bodies or embeddings.
 */

import { useCallback, useState, type JSX } from "react";
import type {
  KnowledgeEntryDto,
  KnowledgeStatusDto,
  KnowledgeUpdatableStatus,
} from "@shared/schemas/knowledge.js";
import {
  useKnowledgeList,
  useUpdateKnowledgeStatus,
} from "../../lib/api/knowledge.js";
import { ConfirmDestructiveDialog } from "./ConfirmDestructiveDialog.js";
import {
  Empty,
  ErrorState,
  Loading,
  PILL,
  SECTION,
  fmtDate,
} from "./KnowledgePanelShared.js";

const ACTION_BTN =
  "rounded px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:bg-white/[0.08] hover:text-foreground";

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

interface PendingAction {
  readonly entry: KnowledgeEntryDto;
  readonly target: KnowledgeUpdatableStatus;
}

function describePending(pending: PendingAction | null): string {
  if (pending === null) return "";
  const what = `"${pending.entry.title}"`;
  return pending.target === "invalidated"
    ? `Mark ${what} as wrong or unsafe. It is removed from active recall. This is one-way — it can't be re-activated.`
    : `Archive ${what} as no longer relevant. It is removed from active recall. This is one-way — it can't be re-activated.`;
}

export function KnowledgeSection(): JSX.Element {
  const [status, setStatus] = useState<KnowledgeStatusDto | "all">("all");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const query = useKnowledgeList(status === "all" ? undefined : status);
  const updateStatus = useUpdateKnowledgeStatus();

  const onAction = useCallback(
    (entry: KnowledgeEntryDto, target: KnowledgeUpdatableStatus): void => {
      setPending({ entry, target });
    },
    [],
  );

  const confirm = useCallback((): void => {
    if (pending === null) return;
    updateStatus.mutate(
      { id: pending.entry.id, status: pending.target },
      { onSettled: () => setPending(null) },
    );
  }, [pending, updateStatus]);

  // Surface a failed mutation (e.g. raced not_found / invalid_state) — the
  // mutationFn resolves with `ok:false`, so check `data`; `isError` covers a
  // thrown transport failure.
  const mutationError =
    updateStatus.data && !updateStatus.data.ok
      ? updateStatus.data.error.message
      : updateStatus.isError
        ? "Unable to update knowledge."
        : null;

  return (
    <section data-vex-section="knowledge" className={SECTION}>
      <div>
        <h2 className="text-sm font-semibold">Knowledge</h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Durable lessons the agent has learned (global, all sessions). Sources
          and statuses are shown so low-confidence entries are visible but
          labeled. Disabling an entry is one-way.
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

      {mutationError !== null ? <ErrorState message={mutationError} /> : null}

      <KnowledgeList query={query} search={search} onAction={onAction} />

      <ConfirmDestructiveDialog
        open={pending !== null}
        title={
          pending?.target === "invalidated"
            ? "Invalidate this knowledge?"
            : "Archive this knowledge?"
        }
        description={describePending(pending)}
        confirmLabel={
          pending?.target === "invalidated" ? "Invalidate" : "Archive"
        }
        tone="destructive"
        pending={updateStatus.isPending}
        onConfirm={confirm}
        onCancel={() => {
          if (!updateStatus.isPending) setPending(null);
        }}
      />
    </section>
  );
}

function KnowledgeList({
  query,
  search,
  onAction,
}: {
  readonly query: ReturnType<typeof useKnowledgeList>;
  readonly search: string;
  readonly onAction: (
    entry: KnowledgeEntryDto,
    target: KnowledgeUpdatableStatus,
  ) => void;
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
        <KnowledgeRow key={k.id} entry={k} onAction={onAction} />
      ))}
    </ul>
  );
}

function KnowledgeRow({
  entry,
  onAction,
}: {
  readonly entry: KnowledgeEntryDto;
  readonly onAction: (
    entry: KnowledgeEntryDto,
    target: KnowledgeUpdatableStatus,
  ) => void;
}): JSX.Element {
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
      {entry.tags.length > 0 ||
      entry.sourceSession !== null ||
      entry.status === "active" ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {entry.tags.map((t) => (
            <span
              key={t}
              className="rounded px-1 py-0.5 text-[10px] text-[var(--color-text-muted)]"
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
          {entry.status === "active" ? (
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => onAction(entry, "archived")}
                aria-label={`Archive ${entry.title}`}
                className={ACTION_BTN}
              >
                Archive
              </button>
              <button
                type="button"
                onClick={() => onAction(entry, "invalidated")}
                aria-label={`Invalidate ${entry.title}`}
                className={ACTION_BTN}
              >
                Invalidate
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
