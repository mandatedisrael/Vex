/**
 * `emitTurnLoopControlState` — extracted helper used by the turn-loop
 * iteration-boundary checkpoint after `observeAndApplyControl`
 * applied a `paused_user` / `stopped` transition.
 *
 * Pure module — no closure dependency on the loop body, so it
 * extracts cleanly out of `turn-loop.ts` for scaling. The lazy
 * imports keep the engine-runtime module graph cheap when the
 * checkpoint never fires (the common case).
 *
 * The runner still owns the lease at this point —
 * `leaseActive: true`, `leaseExpiresAt` from the lease row. After
 * the outer runner releases (via `releaseLeaseAndEmitControlState`)
 * a SECOND event fires with the final state (terminal vs paused_*,
 * lease cleared). Two emits = two refresh signals; renderer sees the
 * final transition.
 */

export async function emitTurnLoopControlState(
  sessionId: string,
  missionRunId: string,
  runStatus: "paused_user" | "stopped",
  stopReason: "user_paused" | "user_stopped",
  correlationId: string | null,
): Promise<void> {
  try {
    const { controlStateBus, CONTROL_STATE_EVENT_TYPE } = await import(
      "../runtime/control-bus.js"
    );
    const { getLease } = await import("../../db/repos/runner-leases.js");
    const lease = await getLease(sessionId);
    controlStateBus.emit({
      type: CONTROL_STATE_EVENT_TYPE,
      sessionId,
      missionRunId,
      runStatus,
      stopReason,
      pendingControlKind: null,
      leaseActive: lease !== null && lease.expiresAt >= new Date(),
      leaseExpiresAt:
        lease !== null && lease.expiresAt >= new Date()
          ? lease.expiresAt.toISOString()
          : null,
      correlationId,
    });
  } catch {
    // intentionally swallowed — runtime path must not break on bus errors
  }
}
