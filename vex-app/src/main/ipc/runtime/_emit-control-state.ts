/**
 * `emitControlStateAfterChange` — post-commit canonical re-read +
 * emit through the engine `controlStateBus`.
 *
 * Routing through the bus (instead of a direct
 * `broadcastToAllWindows`) keeps the `control-bridge` Zod gate as the
 * single validation seam before payloads cross to renderers — even
 * main-side emitters use the same path the engine-side runner uses.
 */

import {
  CONTROL_STATE_EVENT_TYPE,
} from "@shared/schemas/runtime.js";
import { controlStateBus } from "@vex-agent/engine/runtime/control-bus.js";
import { getActiveRunForSession } from "../../database/mission-runs-db.js";
import { log } from "../../logger/index.js";

export async function emitControlStateAfterChange(
  sessionId: string,
  correlationId: string | null,
): Promise<void> {
  const state = await getActiveRunForSession(sessionId);
  if (!state.ok) {
    log.warn(
      `[ipc:runtime] post-change state read failed code=${state.error.code}`,
    );
    return;
  }
  controlStateBus.emit({
    type: CONTROL_STATE_EVENT_TYPE,
    sessionId,
    missionRunId: state.data.missionRunId,
    runStatus: state.data.status,
    stopReason: state.data.stopReason,
    pendingControlKind: state.data.pendingControlKind,
    leaseActive: state.data.leaseActive,
    leaseExpiresAt: state.data.leaseExpiresAt,
    correlationId,
  });
}
