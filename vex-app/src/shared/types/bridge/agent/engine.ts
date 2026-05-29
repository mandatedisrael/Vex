/**
 * `EngineEventsBridge` — main -> renderer push events from the agent
 * runtime spine (engine).
 *
 * Naming follows the `EV.engine.<topic>` channel namespace and the
 * `window.vex.<domain>.on<Topic>` convention used for docker / database
 * progress streams. Each subscription returns an idempotent unsubscribe
 * function; the renderer must call it on cleanup (puzzle 02 mounts the
 * hook in `SessionPanel`, which unsubscribes on unmount).
 *
 * Renderer NEVER reconstructs message rows from the event payload. The
 * event is purely a refresh signal — the DB row is fetched through the
 * existing `messages.getTail` IPC after invalidation.
 */

import type { TranscriptAppendEvent } from "@shared/schemas/messages.js";
import type { ControlStateEvent } from "@shared/schemas/runtime.js";
import type { StreamDeltaEvent } from "@shared/schemas/stream.js";

export interface EngineEventsBridge {
  /**
   * Subscribe to `EV.engine.transcriptAppend` events. The handler is
   * invoked once per committed `messages` INSERT for any session — the
   * renderer hook filters by `event.sessionId`.
   *
   * Returns an idempotent unsubscribe function.
   */
  readonly onTranscriptAppend: (
    cb: (event: TranscriptAppendEvent) => void,
  ) => () => void;

  /**
   * Subscribe to `EV.engine.streamDelta` events — the EPHEMERAL,
   * sanitized token/tool/usage preview emitted once per provider chunk
   * during a turn (puzzle 09). The renderer hook filters by
   * `event.sessionId`, renders a live preview, and discards it once the
   * canonical message arrives via `onTranscriptAppend`. Deltas are never
   * the source of truth and carry no raw tool arguments.
   *
   * Returns an idempotent unsubscribe function.
   */
  readonly onStreamDelta: (
    cb: (event: StreamDeltaEvent) => void,
  ) => () => void;

  /**
   * Subscribe to `EV.engine.controlState` events — broadcast after a
   * committed runtime control transition (pause / stop / resume /
   * wake-cancel) or a lease release (puzzle 03). The renderer hook
   * (`useControlStateLiveSync`) filters by `event.sessionId` and
   * invalidates that session's runtime-state + pending-approvals
   * queries, so composer gating and the inline approval card refresh
   * without relying on polling alone. The payload carries only a lease
   * summary — never owner IDs.
   *
   * Returns an idempotent unsubscribe function.
   */
  readonly onControlState: (
    cb: (event: ControlStateEvent) => void,
  ) => () => void;
}
