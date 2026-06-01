/**
 * Mission IPC barrel — registers all 10 mission handlers.
 *
 * Layout mirrors `runtime/`: one handler per file, shared helpers in
 * `_engine-dispatch.ts`, this barrel composes them.
 *
 * Phase 6 ships 9 real handlers + 1 fail-closed (`updateDraft` —
 * structured setup form lands in phase 7+).
 */

import { registerMissionAcceptContractHandler } from "./accept-contract.js";
import { registerMissionContinueHandler } from "./continue.js";
import { registerMissionGetDiffHandler } from "./get-diff.js";
import { registerMissionGetDraftHandler } from "./get-draft.js";
import { registerMissionGetRenewableSourceHandler } from "./get-renewable-source.js";
import { registerMissionRecoverHandler } from "./recover.js";
import { registerMissionRenewHandler } from "./renew.js";
import { registerMissionRestoreHandler } from "./restore.js";
import { registerMissionRetryHandler } from "./retry.js";
import { registerMissionRewindHandler } from "./rewind.js";
import { registerMissionStartHandler } from "./start.js";
import { registerMissionStopHandler } from "./stop.js";
import { registerMissionUpdateDraftHandler } from "./update-draft.js";

export function registerMissionHandlers(): ReadonlyArray<() => void> {
  return [
    registerMissionGetDraftHandler(),
    registerMissionUpdateDraftHandler(),
    registerMissionGetDiffHandler(),
    registerMissionAcceptContractHandler(),
    registerMissionStartHandler(),
    registerMissionContinueHandler(),
    registerMissionRecoverHandler(),
    registerMissionRetryHandler(),
    registerMissionRewindHandler(),
    registerMissionRestoreHandler(),
    registerMissionRenewHandler(),
    registerMissionStopHandler(),
    registerMissionGetRenewableSourceHandler(),
  ];
}
