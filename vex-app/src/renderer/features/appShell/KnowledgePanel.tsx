/**
 * Knowledge & Memory management panel — a read-only AppShell sub-view
 * (mirrors SettingsPanel). A thin composer over four sections, each in its own
 * module so every file stays under the 400-line budget:
 *
 *  1. **Knowledge** (7-2a/7-2b) — `KnowledgeSection.tsx`
 *  2. **Session memory** (7-2a) — `SessionMemorySection.tsx`
 *  3. **Compaction history** (7-2a) — `CompactionHistorySection.tsx`
 *  4. **Memory & privacy** (7-4) — `MemoryPrivacySection.tsx`
 *
 * Every value is the sanitized DTO from main — never raw narrative bodies,
 * outstanding-item text, or embeddings. Session-scoped sections show a clear
 * empty state when no session is active (and issue no session-scoped query).
 * Shared presentational primitives live in `KnowledgePanelShared.tsx`.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button.js";
import { useUiStore } from "../../stores/uiStore.js";
import { KnowledgeSection } from "./KnowledgeSection.js";
import { MemorySection } from "./SessionMemorySection.js";
import { CompactionHistorySection } from "./CompactionHistorySection.js";
import { MemoryPrivacySection } from "./MemoryPrivacySection.js";

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
          <MemoryPrivacySection />
        </div>
      </div>
    </div>
  );
}
