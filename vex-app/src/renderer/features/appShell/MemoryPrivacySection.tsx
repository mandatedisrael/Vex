/**
 * Memory & privacy section of the Memory panel (7-4).
 *
 * Read-only transparency for the remote compaction path. Names the model that
 * builds memory (the SAME global `AGENT_MODEL` the agent uses, via
 * `useAvailableModels`) and states plainly what is redacted before a transcript
 * leaves the machine. This is deliberately a disclosure, not a toggle: Track-2
 * compaction is enabled-by-default (product sign-off) and the redaction
 * guarantee is owned upstream (engine redaction + the support-bundle scrub
 * proven by `bug-report-service.test.ts`) — nothing here re-implements it.
 */

import type { JSX } from "react";
import { useAvailableModels } from "../../lib/api/models.js";
import { SECTION } from "./MemoryPanelShared.js";

export function MemoryPrivacySection(): JSX.Element {
  const models = useAvailableModels();
  const res = models.data;
  const model =
    res !== undefined && res.ok && res.data.source === "global_default"
      ? (res.data.models[0] ?? null)
      : null;

  return (
    <section data-vex-section="memory-privacy" className={SECTION}>
      <div>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--vex-text-3)]">
          Memory &amp; privacy
        </h2>
        <p className="mt-1 text-xs text-[var(--vex-text-2)]">
          How Vex builds long-term memory, and what leaves your machine.
        </p>
      </div>

      <p
        data-vex-memory-model
        className="text-xs text-[var(--vex-text-2)]"
      >
        {models.isLoading ? (
          "Checking the configured model…"
        ) : model !== null ? (
          <>
            Memory is built by{" "}
            <span className="font-mono text-foreground">{model.modelId}</span>{" "}
            via OpenRouter.
          </>
        ) : (
          "The memory builder is idle until an OpenRouter model is configured."
        )}
      </p>

      <div className="flex flex-col gap-2 text-xs text-[var(--vex-text-2)]">
        <p>
          When older messages are compacted into memory, Vex sends a{" "}
          <span className="text-foreground">redacted</span> copy of that
          archived transcript to your OpenRouter model. Before it leaves your
          machine, secrets — wallet seeds, private keys, API keys, and JWTs —
          are removed, and wallet/contract addresses and transaction hashes are
          masked.
        </p>
        <p>
          Only the sanitized summary and structured chunks are stored. Logs and
          support reports never include unredacted memory payloads: raw
          transcript text and embeddings are not attached to them.
        </p>
        <p className="text-[var(--vex-text-3)]">
          This runs automatically in the background (enabled by default).
        </p>
      </div>
    </section>
  );
}
