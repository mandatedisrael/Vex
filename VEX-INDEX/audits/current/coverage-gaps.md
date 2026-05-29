---
id: audit.current.coverage-gaps
kind: audit
paths: ["src/**", "vex-app/**", ".github/workflows/**"]
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change: ["src/**", "vex-app/**", ".github/workflows/**", "VEX-INDEX/modules/**/*.md"]
related: [index.structure, index.modules]
---

# Current Coverage Gaps

| ID | Area | Status | Evidence |
|---|---|---|---|
| GAP-Z6-sync-worker | Sync executor not wired in desktop boot | fixed | Bundle A (Round 4): `setupSyncWorker()` wired in `vex-app/src/main/index.ts` after wake + drained in the Promise.allSettled; new `agent/sync-worker.ts` (no provider gate; public-address egress framing) + `database/sync-db.ts` (`to_regclass('public.protocol_sync_jobs')`). Dual Codex GREEN LIGHT. |
| GAP-Z7-control-state-bridge | `EV.engine.controlState` not exposed to renderer (F5) | fixed | Bundle B / F5 (commit 85ed941). Preload `onControlState` added (`preload/agent/engine.ts` → `subscribe(EV.engine.controlState, controlStateEventSchema, cb)`) + `EngineEventsBridge.onControlState` type. Renderer `useControlStateLiveSync` (`renderer/lib/api/runtime.ts`) mounted in `SessionPanel` pushes invalidation of `runtimeKeys.state` + `approvalsKeys.pending` per event, with a 30s runtime fallback. `ApprovalsRegion` 5s poll retained as a fast fallback — the controlState emit is post-commit on lease release, not part of the approval transaction (Codex). Codex GREEN LIGHT (plan + final review). |
| GAP-Z7-runtime-types | Runtime bridge return types use legacy result shape (F6) | fixed | Bundle B / F6 (commit 85ed941). `RuntimeBridge` + renderer mutation hooks retyped to the per-action discriminated unions (`RuntimeRequestPauseResult`/`StopResult`/`ResumeResult`/`CancelWakeResult`); legacy `runtimeRequestResultSchema`/`RuntimeRequestResult` deleted from `shared/schemas/runtime.ts` (+ its legacy test). Preload unchanged — `satisfies RuntimeBridge` re-infers `T` from the contextual return type. `tsc --noEmit` clean. Codex GREEN LIGHT. |
| GAP-updater | Updater is placeholder-only (F12) | open | dependency/channels exist, no registered handler/autoUpdater implementation. Candidate Bundle B (user-triggered, autoDownload=false). |
| GAP-release | Production release gates missing | open | builder profile unsigned; CI has no signing/notarization/update metadata/checksum workflow |
| GAP-docker-e2e | Full Docker/Compose/migration/onboarding E2E absent | open | smoke test excludes daemon/bootstrap/wizard/unlock |
| GAP-vex-app-deep-index | vex-app module docs were seed-level | fixed | Round 3 expanded to 10 deep vex-app module docs + 6 flows + 4 boundaries (commit 041ce57). |

Fixed/superseded gaps: F1 `.env` boot-load, F2 wake worker, F3 approval card UI, F11 sync worker (Bundle A), FINDING-security-003 lock scrub (Bundle A), FINDING-security-005 document_delete gate (Bundle A).
