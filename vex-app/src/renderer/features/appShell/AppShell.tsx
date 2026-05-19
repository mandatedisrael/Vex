/**
 * App shell — top-level container for the post-wizard surface (M12).
 *
 * Layout:
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ topbar (logo, Edit infrastructure)                             │
 *   ├──────────────┬─────────────────────────────────────────────────┤
 *   │ Sessions     │ SessionPanel (welcome / metadata)               │
 *   │ Sidebar      │                                                 │
 *   │              │                                                 │
 *   │              │                                                 │
 *   └──────────────┴─────────────────────────────────────────────────┘
 *
 * Owns the SessionCreator dialog state so that BOTH the sidebar's
 * "+ New" button and the welcome banner's CTA route through one source
 * of truth.
 */

import { useCallback, useState } from "react";
import type { JSX } from "react";
import { EditInfrastructureButton } from "./EditInfrastructureButton.js";
import { ReportIssueButton } from "./ReportIssueButton.js";
import { SessionCreator } from "./SessionCreator.js";
import { SessionPanel } from "./SessionPanel.js";
import { SessionsList } from "./SessionsList.js";

export function AppShell(): JSX.Element {
  const [creatorOpen, setCreatorOpen] = useState<boolean>(false);
  const openCreator = useCallback(() => setCreatorOpen(true), []);

  return (
    <main
      className="grid h-screen grid-cols-[280px_1fr] grid-rows-[56px_1fr] bg-background text-foreground"
      data-vex-screen="appShell"
    >
      <header className="col-span-2 flex items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-3">
          <img
            src="/vex.jpg"
            alt=""
            draggable={false}
            className="h-8 w-8 rounded-full object-cover ring-1 ring-primary/40"
          />
          <span className="text-sm font-semibold tracking-tight">Vex</span>
        </div>
        <div className="flex items-center gap-2">
          <ReportIssueButton />
          <EditInfrastructureButton />
        </div>
      </header>

      <SessionsList onCreate={openCreator} />

      <section className="overflow-hidden">
        <SessionPanel onCreate={openCreator} />
      </section>

      <SessionCreator open={creatorOpen} onOpenChange={setCreatorOpen} />
    </main>
  );
}
