/**
 * BOOK — the on-demand right-side instrument panel (a new <aside> sibling in the
 * AppShell <main> flex row). Per-session register: MOVES (what the agent did),
 * RUNTIME & COST (model/context/usage/compaction), SESSION (metadata), POSITION
 * (the session's scoped wallet portfolio). The global no-session view shows the
 * GLOBAL inventory POSITION ("Portfolio").
 *
 * Mode is a pure derivation of `activeSessionId`: null = welcome (global), else
 * the open session (scoped). `PositionBlock` takes `activeSessionId` directly and
 * resolves its own scope via `usePortfolio`. Signal Tape language: surface-1,
 * hairline border-l, blue rationed to the content. Slides in via a CSP-safe
 * one-shot keyframe (`vex-book-enter`); reduced motion collapses it to the
 * final frame.
 */

import type { JSX } from "react";
import { SessionRuntimeBar } from "./SessionRuntimeBar.js";
import { BookBlock } from "./book/BookBlock.js";
import { MovesBlock } from "./book/MovesBlock.js";
import { PositionBlock } from "./book/PositionBlock.js";
import { SessionBlock } from "./book/SessionBlock.js";

export function BookPanel({
  activeSessionId,
}: {
  readonly activeSessionId: string | null;
}): JSX.Element {
  return (
    <aside
      data-vex-area="book-panel"
      aria-label="Session instrument"
      className="vex-book-enter flex h-full w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-[var(--vex-line)] bg-[var(--vex-surface-1)] p-3"
    >
      {activeSessionId !== null ? (
        <>
          <PositionBlock activeSessionId={activeSessionId} hero />
          <MovesBlock sessionId={activeSessionId} />
          <BookBlock title="Runtime & Cost">
            <SessionRuntimeBar sessionId={activeSessionId} layout="stack" />
          </BookBlock>
          <SessionBlock sessionId={activeSessionId} />
        </>
      ) : (
        // Global portfolio (no active session) — the configured inventory.
        <PositionBlock activeSessionId={null} hero />
      )}
    </aside>
  );
}
