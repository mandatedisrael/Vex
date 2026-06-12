/**
 * Memory panel — a read-only AppShell sub-view.
 * A thin composer over seven sections, each in its own
 * module so every file stays under the 400-line budget:
 *
 *  1. **Long-term memory** (S9 rewire) — `LongMemorySection.tsx`
 *  2. **Memory candidates** (S10 inspector) — `CandidatesSection.tsx`
 *  3. **Manager decisions** (S10 inspector) — `DecisionsSection.tsx`
 *  4. **Memory jobs** (S10 inspector) — `JobsSection.tsx`
 *  5. **Session memory** (7-2a) — `SessionMemorySection.tsx`
 *  6. **Compaction history** (7-2a) — `CompactionHistorySection.tsx`
 *  7. **Memory & privacy** (7-4) — `MemoryPrivacySection.tsx`
 *
 * Every value is the sanitized DTO from main — never raw narrative bodies,
 * outstanding-item text, or embeddings. Session-scoped sections show a clear
 * empty state when no session is active (and issue no session-scoped query).
 * Shared presentational primitives live in `MemoryPanelShared.tsx`.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useUiStore } from "../../stores/uiStore.js";
import { LongMemorySection } from "./LongMemorySection.js";
import { CandidatesSection } from "./CandidatesSection.js";
import { DecisionsSection } from "./DecisionsSection.js";
import { JobsSection } from "./JobsSection.js";
import { MemorySection } from "./SessionMemorySection.js";
import { CompactionHistorySection } from "./CompactionHistorySection.js";
import { MemoryPrivacySection } from "./MemoryPrivacySection.js";

export function MemoryPanel(): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const activeSessionId = useUiStore((s) => s.activeSessionId);

  return (
    <div
      data-vex-screen="memory"
      className="flex h-full min-h-0 flex-col text-foreground"
    >
      {/* Register header — same h-12 datum as the desk rule (S7); the back
       * affordance is a quiet icon key, never a chrome pill. */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--vex-line)] px-6">
        <button
          type="button"
          onClick={() => setAppShellView("session")}
          aria-label="Back to chat"
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--vex-text-2)] transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={17} aria-hidden />
        </button>
        <h1 className="font-mono text-[13px] font-medium uppercase tracking-[0.3em] text-foreground">
          Memory
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {/* Sections are hairline-separated ledger groups (SECTION in
         * MemoryPanelShared) — separation lives on the section borders,
         * not on flex gaps, so the page reads as one continuous register. */}
        <div className="mx-auto flex w-full max-w-[760px] flex-col">
          <LongMemorySection />
          {/* S10 inspector trio — read-only manager pipeline views. */}
          <CandidatesSection />
          <DecisionsSection />
          <JobsSection />
          <MemorySection sessionId={activeSessionId} />
          <CompactionHistorySection sessionId={activeSessionId} />
          <MemoryPrivacySection />
        </div>
      </div>
    </div>
  );
}
