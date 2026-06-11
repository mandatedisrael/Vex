/**
 * Stream-preview live sync (Stage 9-3).
 *
 * Subscribes the active session to the engine stream spine and drives the
 * ephemeral `streamStore`:
 *  - `onStreamDelta` → accumulate the preview (text/tool/reasoning/usage/
 *    phase/status — reasoning is batched inside the store, see `applyDelta`);
 *  - `onTranscriptAppend` (assistant role) → the streamed text is now
 *    persisted, so clear the preview. We AWAIT the transcript query refetch
 *    first (TanStack v5 `invalidateQueries` resolves after active refetches)
 *    so the canonical row is in cache before the preview disappears — no
 *    swap gap.
 *
 * Orphan safety: a stream that errors/aborts without persisting would leave a
 * preview behind, so an idle timer (re-armed on every delta) clears it after
 * inactivity. Every timer + subscription is owned here and torn down on
 * clear / session change / unmount. Pure side effect; mount once per active
 * session (`SessionPanel`).
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStreamStore } from "../../stores/streamStore.js";
import { messagesKeys } from "./queryKeys.js";

/** Clear an in-flight preview this long after the last delta (orphan net). */
export const STREAM_PREVIEW_IDLE_MS = 60_000;

export function useStreamPreviewSync(sessionId: string | null): void {
  const queryClient = useQueryClient();
  const applyDelta = useStreamStore((s) => s.applyDelta);
  const clear = useStreamStore((s) => s.clear);

  useEffect(() => {
    if (sessionId === null || sessionId.length === 0) return;

    let alive = true;
    let idleTimer: number | undefined;

    const disarmIdle = (): void => {
      if (idleTimer !== undefined) {
        window.clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };
    const clearAll = (): void => {
      disarmIdle();
      clear(sessionId);
    };

    const offDelta = window.vex.engine.onStreamDelta((event) => {
      if (event.sessionId !== sessionId) return;
      applyDelta(sessionId, event);
      disarmIdle();
      idleTimer = window.setTimeout(() => {
        if (alive) clearAll();
      }, STREAM_PREVIEW_IDLE_MS);
    });

    const offAppend = window.vex.engine.onTranscriptAppend((event) => {
      if (event.sessionId !== sessionId || event.role !== "assistant") return;
      // The append carries no streamId. Capture the preview that is live NOW —
      // the just-finished stream, since IPC delivers this append before the
      // next stream's first delta. Wait for the persisted row to land in cache,
      // then clear ONLY if that SAME stream is still showing: a newer stream
      // that started during the await must be preserved (it clears on its own
      // append).
      const targetStreamId =
        useStreamStore.getState().bySessionId[sessionId]?.streamId;
      if (targetStreamId === undefined) return;
      void (async () => {
        await queryClient.invalidateQueries({
          queryKey: messagesKeys.forSession(sessionId),
        });
        if (!alive) return;
        if (
          useStreamStore.getState().bySessionId[sessionId]?.streamId ===
          targetStreamId
        ) {
          clearAll();
        }
      })();
    });

    return () => {
      alive = false;
      offDelta();
      offAppend();
      clearAll();
    };
  }, [sessionId, queryClient, applyDelta, clear]);
}
