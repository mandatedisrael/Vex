---
id: module.vex-agent.engine-mission
kind: module
paths:
  - "src/vex-agent/engine/mission/**"
source_commit: c138af8
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/engine/mission/**"
  - "src/vex-agent/engine/types.ts"
  - "src/vex-agent/db/repos/missions.ts"
  - "src/vex-agent/db/repos/mission-runs.ts"
  - "src/vex-agent/db/repos/rewind-checkpoints.ts"
  - "src/vex-agent/db/migrations/023_mission_acceptance_and_checkpoints.sql"
related:
  - module.vex-agent.engine-runner
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.engine-wake-subagents-prompts
  - module.vex-agent.data-memory-knowledge
  - ADR-0001-global-model-session-wallet
---

# module.vex-agent.engine-mission — Mission domain primitives

## Purpose

Owns all mission-domain primitives consumed by the engine runners: contract acceptance (host-only SHA-256 hash gate), atomic mission start (`commitMissionStart`), draft management (patch parsing, validation, mapper), contract snapshot (frozen run context), renew (clone accepted terminal mission to fresh draft), restore (LIFO rewind checkpoint unarchive), and stop-reason authorization. These are stateless-or-DB-transactional helpers; the long-running turn loop and run lifecycle (`runTurnLoop`, leases, status flips) live in `engine/core/runner/*` (module.vex-agent.engine-runner).

## Retrieval keywords

- mission contract, contract hash, acceptContract, commitMissionStart
- mission draft, applyMissionPatch, createMissionDraft, getMissionSetupState
- mission renew, /mission-renew, renewMission, cloneMissionAsDraft
- mission restore, /restore, restoreLatestCheckpoint, rewind checkpoint, LIFO
- mission run snapshot, contractSnapshotJson, MissionRunContractSnapshot
- mission stop, authorizeMissionStopReason, stop conditions, MODEL_MISSION_STOP_REASONS
- mission validator, isReadyToStart, MISSION_DRAFT_REQUIRED_FIELDS
- contract diff, getContractStatus, isDirty, isAccepted
- patch parser, stopConditionsAccepted removed, host-only acceptance
- SHA-256, canonicalStringify, CONTRACT_HASH_VERSION, chk_missions_acceptance_atomicity
- MissionDraft, MissionPatch, MissionStatus (draft→ready→running→completed/failed/cancelled)

## State owned

**DB tables (writes directly or via repo helpers):**
- `missions` — acceptance four-tuple (`accepted_contract_hash`, `accepted_contract_at`, `accepted_contract_by`, `contract_hash_version`), status (`draft`→`ready`→`running`→terminal), `approved_at`, `renewed_from_mission_id`. CHECK constraint `chk_missions_acceptance_atomicity` (migration 023) enforces all-or-none on the four-tuple.
- `mission_runs` — created inside `commitMissionStart` (step 8 of 8 inside the same `withTransaction`). The `contract_snapshot_json` column captures the frozen draft at start time.
- `messages` / `messages_archive` — `restoreLatestCheckpoint` unarchives stamped rows (DELETE FROM archive + INSERT INTO messages in one CTE). `sessions.message_count` is incremented atomically.
- `rewind_checkpoints` — `restore_idempotency_key` + `restored_at` stamped by `markCheckpointRestored`.
- `runner_leases` — `restoreLatestCheckpoint` acquires/releases a short-TTL lease (30s) inside the tx.

**No Zustand stores, no event buses (except post-commit emit in restore — see below).**

## Boundary crossings

- **DB**: `withTransaction` from `src/vex-agent/db/client.ts`; repos `missions`, `mission-runs`, `rewind-checkpoints`, `runner-leases`, `approval-queue` (read-only check in restore).
- **Crypto**: `node:crypto` — `createHash("sha256")` in `contract-hash.ts:147 computeContractHash`; `randomUUID()` in `renew.ts:148` and `restore.ts:158`.
- **Event bus (post-commit only)**: `restore.ts` calls `emitRestoredMessages` on `transcriptEventBus` AFTER the transaction commits (line 290) — never inside the tx. Emits one `TranscriptAppendEvent` per restored message.
- **No IPC, no network, no Docker, no wallet/signing authority.**

## File map

- `src/vex-agent/engine/mission/acceptance.ts:92 assertAcceptedContract` — read-only row-locked acceptance check (used by IPC to decide whether to show Start button); `:166 acceptContract` — host-only acceptance write: row-lock → recompute hash → status gate (draft|ready only) → no-active-run gate → write four-tuple atomically.
- `src/vex-agent/engine/mission/commit-start.ts:98 commitMissionStart` — 8-step atomic gate→flip→run-create inside single `withTransaction`. Closes the TOCTOU window between `assertAcceptedContract` and `startMission`. Exports `CommitMissionStartInput`, `CommitMissionStartOutcome`.
- `src/vex-agent/engine/mission/contract-hash.ts:57 CONTRACT_HASH_VERSION` — version literal (currently `1`); `:100 buildContractMaterial` — normalizes `MissionDraft` into canonical shape (RFC 8785 minimal); `:128 canonicalStringify` — deterministic depth-sorted JSON; `:146 computeContractHash` — SHA-256 hex of canonical material.
- `src/vex-agent/engine/mission/diff.ts:59 getContractStatus` — plain (non-locked) read: `currentHash`, `acceptedHash`, `isAccepted`, `isDirty`. Used by renderer's MissionContractCard via IPC `vex:mission:getDiff`.
- `src/vex-agent/engine/mission/mapper.ts:14 missionToDraft` — DB `Mission` row → domain `MissionDraft`; `:33 domainToRow` — `Partial<MissionDraft>` → `MissionDraftRow` for `updateDraft`; `:76 freezeDraft` — immutable snapshot (id, title, goal, draft, approvedAt); `:89 draftToPromptContext` — human-readable Markdown for prompt injection.
- `src/vex-agent/engine/mission/patch-parser.ts:48 extractMissionPatch` — safe extract from `unknown` model output; `:74 sanitizePatch` — trim + length cap (string ≤2000, array ≤50 items × 500 chars); `:111 parseModelMissionOutput` — JSON block or raw object extraction from text. `stopConditionsAccepted` key is **not** in `ALL_ALLOWED_KEYS` — silently dropped (puzzle 04 security invariant).
- `src/vex-agent/engine/mission/renew.ts:85 renewMission` — clone accepted + terminal mission into fresh draft row. Guards: source session ownership, accepted-hash non-null, last run terminal, target session has no active run. NOT idempotent by design.
- `src/vex-agent/engine/mission/renew-internals.ts:22 cloneMissionAsDraft` — `INSERT INTO missions SELECT` with overrides: status `draft`, acceptance four-tuple NULL, `renewed_from_mission_id = source.id`.
- `src/vex-agent/engine/mission/restore.ts:155 restoreLatestCheckpoint` — LIFO: session lock → lease claim → idempotency replay → checkpoint FOR UPDATE → active-run + pending-approval blocking checks → unarchive stamped rows → increment `message_count` → stamp checkpoint → release lease → post-commit emit.
- `src/vex-agent/engine/mission/restore-internals.ts` — SQL helpers: `unarchiveStampedRows` (CTE DELETE+INSERT), `checkActiveRun`, `checkPendingApproval`, `checkExistingIdempotencyMatch`, `incrementSessionMessageCount`, `emitRestoredMessages`.
- `src/vex-agent/engine/mission/run-contract.ts:22 buildMissionRunContractSnapshot` — builds `MissionRunContractSnapshot` (version, capturedAt, missionPromptContext, frozenMission) for `createRun`; `:31 resolveMissionPromptContext` — safe parse with fallback to live mission row; `:40 requireMissionPromptContextFromSnapshot` — hard require for recovery path (throws if missing).
- `src/vex-agent/engine/mission/setup.ts:50 createMissionDraft` — create blank draft row; `:73 applyMissionPatch` — patch pipeline: extract → sanitize → domainToRow → updateDraft; auto-flips status draft↔ready based on validation; `:135 getMissionSetupState` — read-only current state + validation.
- `src/vex-agent/engine/mission/stop-contract.ts:72 authorizeMissionStopReason` — policy: `goal_reached`+`emergency_stop` always allowed; `user_stopped` host-only (never model); user-configurable reasons (`deadline_reached`, `capital_depleted`, `max_loss_hit`, `no_viable_opportunity`) require `accepted_contract_hash IS NOT NULL` + reason in `stopConditionsJson`; `:100 normalizeStopConditionReason` — fuzzy text→canonical mapping.
- `src/vex-agent/engine/mission/validator.ts:53 validateDraft` / `:59 getMissingFields` / `:79 isReadyToStart` — pure functions, no DB. Checks `MISSION_DRAFT_REQUIRED_FIELDS` (10 fields, `deadline` excluded as optional).

## Key types & invariants

- `MissionDraft` (`src/vex-agent/engine/types.ts:183`) — domain model; `deadline` is optional; all others required for ready transition.
- `MissionPatch` (`src/vex-agent/engine/types.ts:218`) — `{[key: string]: unknown}` — untrusted model output; boundary-sanitized before DB write.
- `MissionStatus` (`src/vex-agent/engine/types.ts:39`) — `draft | ready | running | completed | failed | cancelled`. Transitions: draft↔ready (validation-driven, reversible), ready→running (commitMissionStart), running→terminal.
- `CanonicalContractMaterial` (`contract-hash.ts:73`) — Zod-validated; `.parse()` used as invariant check. VERSION=1; `title` and `approvedAt` excluded from hash intentionally.
- `MissionRunContractSnapshot` (`run-contract.ts:20`) — `{version:1, capturedAt, missionPromptContext, frozenMission}`. Versioned Zod schema; `resolveMissionPromptContext` falls back to live row if parse fails.
- **Acceptance four-tuple invariant**: `chk_missions_acceptance_atomicity` DB CHECK — all four columns are either all NULL or all non-NULL. Any partial write is rejected at the DB level in addition to the code-level `updateAcceptance` atomic write.
- **Model cannot set acceptance**: `patch-parser.ts` `ALL_ALLOWED_KEYS` excludes `stopConditionsAccepted` (and no acceptance key). `acceptContract` and `commitMissionStart` require `sessionId` and a hash computed from the locked row — not from untrusted input.
- **Restore is idempotent**: same `idempotencyKey` returns `noop_already_restored` without re-mutating. UNIQUE INDEX on `restore_idempotency_key` is the DB-level guard.
- **Renew is NOT idempotent**: two clicks = two draft rows. Documented intentional design; renderer must gate.
- **ADR-0001 compliance**: no per-session model field anywhere in this module. `MissionDraft`, `MissionRunContractSnapshot`, `CanonicalContractMaterial` have no model-related fields.

## Capabilities (stable IDs)

- **CAP-mission-accept-contract**: Host-only contract acceptance with hash anti-drift gate — `acceptance.ts:166 acceptContract`
- **CAP-mission-assert-accepted**: Read-only acceptance check for IPC Start-button decision — `acceptance.ts:92 assertAcceptedContract`
- **CAP-mission-commit-start**: Atomic 8-step gate→flip→run-create transaction — `commit-start.ts:98 commitMissionStart`
- **CAP-mission-compute-hash**: Deterministic SHA-256 contract hash (canonical JSON, Zod-validated material) — `contract-hash.ts:146 computeContractHash`
- **CAP-mission-get-contract-status**: Read-only diff (isAccepted, isDirty, hashes) for renderer card — `diff.ts:59 getContractStatus`
- **CAP-mission-apply-patch**: Safe model→DB pipeline (extract + sanitize + validate + status flip) — `setup.ts:73 applyMissionPatch`
- **CAP-mission-create-draft**: Create blank draft row with empty required-fields list — `setup.ts:50 createMissionDraft`
- **CAP-mission-get-setup-state**: Read-only draft state + validation for turn context — `setup.ts:135 getMissionSetupState`
- **CAP-mission-renew**: Clone accepted+terminal mission to fresh draft (not idempotent) — `renew.ts:85 renewMission`
- **CAP-mission-restore-checkpoint**: LIFO unarchive with lease, idempotency, blocking checks, post-commit emit — `restore.ts:155 restoreLatestCheckpoint`
- **CAP-mission-build-snapshot**: Freeze accepted draft into immutable run snapshot — `run-contract.ts:22 buildMissionRunContractSnapshot`
- **CAP-mission-resolve-prompt-context**: Resolve mission prompt context from snapshot or fallback — `run-contract.ts:31 resolveMissionPromptContext`
- **CAP-mission-require-snapshot**: Hard require snapshot context for recovery path — `run-contract.ts:40 requireMissionPromptContextFromSnapshot`
- **CAP-mission-authorize-stop**: Policy enforcement: model stop reason vs accepted contract — `stop-contract.ts:72 authorizeMissionStopReason`
- **CAP-mission-normalize-stop-condition**: Fuzzy text→canonical stop reason mapping — `stop-contract.ts:100 normalizeStopConditionReason`
- **CAP-mission-validate-draft**: Pure completeness check (no DB) — `validator.ts:53 validateDraft` / `:79 isReadyToStart`
- **CAP-mission-map-domain-row**: Bidirectional DB↔domain conversion + prompt context string — `mapper.ts:14 missionToDraft`, `:33 domainToRow`, `:89 draftToPromptContext`

## Public API (consumed by)

**Engine-internal callers (Z1/Z2):**
- `src/vex-agent/engine/core/runner/mission-prepare.ts:214` — calls `commitMissionStart` (step 7 of 8-step prepareMissionStart)
- `src/vex-agent/engine/core/runner/mission-run.ts:227` — calls `resolveMissionPromptContext` for resumed run prompt hydration
- `src/vex-agent/engine/core/runner/recover-prepare.ts:105` — calls `requireMissionPromptContextFromSnapshot` for recovery prompt
- `src/vex-agent/engine/core/runner/setup-turn.ts:90,145,152` — calls `getMissionSetupState` and `applyMissionPatch` during guided mission setup turns
- `src/vex-agent/tools/internal/mission.ts:65,119` — `mission_draft_update` tool calls `applyMissionPatch`; `mission_stop` tool calls `authorizeMissionStopReason`
- `src/vex-agent/engine/prompts/mission-setup.ts` — references stop-condition canonical reasons in prompt copy (informational, no runtime call)

**vex-app IPC callers (Z6, via dynamic `import("@vex-agent/...")`):**
- `vex-app/src/main/ipc/mission/accept-contract.ts:31` → `acceptContract` (channel `vex:mission:acceptContract`)
- `vex-app/src/main/ipc/mission/get-diff.ts:33` → `getContractStatus` (channel `vex:mission:getDiff`)
- `vex-app/src/main/ipc/mission/restore.ts:33` → `restoreLatestCheckpoint` (channel `vex:mission:restore`)
- `vex-app/src/main/ipc/mission/renew.ts:32` → `renewMission` (channel `vex:mission:renew`)

**Note**: `acceptContract`, `commitMissionStart`, `renewMission`, `restoreLatestCheckpoint` are NOT re-exported from `engine/index.ts`. The IPC handlers import directly from the sub-module paths. `createMissionDraft`/`applyMissionPatch`/`getMissionSetupState` are called by the runner internals only, not via IPC directly.

## Internal flow

### Contract acceptance → mission start (happy path)

1. Renderer calls `window.vex.mission.getDiff` → Z6 IPC `get-diff.ts` → `getContractStatus` (plain read, returns `currentHash`+`isAccepted`).
2. Renderer shows MissionContractCard; user clicks "Accept contract" → `window.vex.mission.acceptContract({sessionId, missionId, contractHash})`.
3. Z6 IPC `accept-contract.ts` → `acceptContract`: row-lock missions → recompute hash → session check → status gate → no-active-run gate → write four-tuple → re-read for timestamp.
4. TanStack `onSuccess` invalidates `missionKeys.diff` + `missionKeys.draft` in renderer.
5. User clicks "Start" → renderer slash `/mission start` → `window.vex.mission.start` → Z6 IPC `mission/start.ts` → `prepareMissionStart` (8 steps) → step 7: `commitMissionStart` → row-lock → re-verify hash + version → readiness check → no-active-run check → `setStatus("running")` → `setApprovedAt` → `buildMissionRunContractSnapshot` → `createRun` — all in one tx.
6. `runPreparedMissionStart` proceeds outside the tx (turn loop, maxIter=50).

### Mission renew (/mission-renew)

1. Renderer slash `/mission-renew` → `window.vex.mission.renew({sessionId, previousMissionId})`.
2. Z6 IPC `renew.ts` → `renewMission`: row-lock source → session check → accepted-hash check → last-run terminal check → session-active-run check → `cloneMissionAsDraft` (INSERT SELECT with resets).
3. Returns `{outcome:"renewed", newMissionId}` — new draft immediately in `draft` status, acceptance NULL.

### Restore (/restore)

1. Z6 IPC `restore.ts` → `restoreLatestCheckpoint({sessionId, idempotencyKey})`.
2. `withTransaction`: session row FOR UPDATE → `acquireLease` (30s TTL) → idempotency replay check → `getLatestUnrestoredCheckpoint` + FOR UPDATE → `checkActiveRun` → `checkPendingApproval` → `unarchiveStampedRows` (CTE) → `incrementSessionMessageCount` → `markCheckpointRestored` → `releaseLease`.
3. Post-COMMIT: `emitRestoredMessages` → `transcriptEventBus` (one event per restored message, `correlationId = restore:<checkpointId>`).

### Model patch pipeline (mission_draft_update tool)

1. Agent calls `mission_draft_update` tool with raw JSON args.
2. `tools/internal/mission.ts:65` → `applyMissionPatch(context.missionId, rawArgs)`.
3. `setup.ts:73`: `extractMissionPatch(unknown)` drops non-allowed keys (incl. any `stopConditionsAccepted`) → `sanitizePatch` (trim, length caps) → `domainToRow` → `missionsRepo.updateDraft` → re-validate → flip status draft↔ready.

## Dependencies

**Imports FROM:**
- `src/vex-agent/db/client.ts` — `withTransaction`, `executeWith`, `queryOneWith`, `queryWith`
- `src/vex-agent/db/repos/missions.ts` — `getMission`, `getMissionForUpdate`, `updateAcceptance`, `clearAcceptance`, `createDraft`, `updateDraft`, `setStatus`, `setApprovedAt`, `getActiveMission`
- `src/vex-agent/db/repos/mission-runs.ts` — `getActiveRun`, `getActiveRunBySession`, `createRun`
- `src/vex-agent/db/repos/rewind-checkpoints.ts` — `getLatestUnrestoredCheckpoint`, `getCheckpointForUpdate`, `markCheckpointRestored`
- `src/vex-agent/db/repos/runner-leases.ts` — `acquireLease`, `getLease`, `releaseLease`
- `src/vex-agent/engine/types.ts` — `MissionDraft`, `MissionPatch`, `MISSION_DRAFT_REQUIRED_FIELDS`, `BusinessStopReason`, `ACTIVE_OR_PAUSED_RUN_STATUSES`
- `src/vex-agent/engine/events/transcript-bus.ts` — `transcriptEventBus`, `TRANSCRIPT_APPEND_EVENT_TYPE` (restore post-commit emit only)
- `node:crypto` — `createHash`, `randomUUID`
- `zod` — `z` (Zod 4.x, schema validation in `contract-hash.ts` and `run-contract.ts`)

**Consumed BY:**
- `module.vex-agent.engine-runner` — `mission-prepare.ts`, `mission-run.ts`, `recover-prepare.ts`, `setup-turn.ts`
- `src/vex-agent/tools/internal/mission.ts` — `applyMissionPatch`, `authorizeMissionStopReason`
- Z6 IPC handlers: `vex-app/src/main/ipc/mission/{accept-contract,get-diff,restore,renew}.ts`
- `src/vex-agent/engine/prompts/mission-setup.ts` (informational prompt copy only)

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-mission-accept-contract` (implemented; IPC wired)
- vex-app coverage: `audits/current/coverage-gaps.md#CAP-mission-restore-checkpoint` (implemented; IPC wired)
- vex-app coverage: `audits/current/coverage-gaps.md#CAP-mission-renew` (implemented; IPC wired)
- quality findings: `audits/current/quality-findings.md` — no mission-specific findings open at source_commit
- related flows: `flows/mission-start.md` (not yet written — Round 2)
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md` — no per-session model anywhere in this module; `MissionDraft` and `CanonicalContractMaterial` have no model field (ADR-compliant)

## Divergence flags (ADR-0001)

No divergence found. `CanonicalContractMaterial` (contract-hash.ts:59) does not include model fields. `MissionRunContractSnapshot` (run-contract.ts:13) does not include model fields. The `frozenMission` field in snapshot is typed `z.unknown()` — a potential future drift risk if callers embed model selection in `FrozenMission` via `mapper.ts:freezeDraft`. Current `FrozenMission` (mapper.ts:67) has no model field. Flag if `FrozenMission` or `CanonicalContractMaterial` gains a `modelId` or `model` key.

## Refresh triggers

This doc is stale when:
- `src/vex-agent/engine/mission/**` changes (any file)
- `src/vex-agent/engine/types.ts` changes `MissionDraft`, `MissionPatch`, `MISSION_DRAFT_REQUIRED_FIELDS`, `BusinessStopReason`, or `MissionStatus`
- `src/vex-agent/db/repos/missions.ts` changes `Mission` shape or acceptance columns
- `src/vex-agent/db/migrations/023_*.sql` or any later migration touching `missions` columns changes
- `vex-app/src/main/ipc/mission/*.ts` wires a new direct import from this module

## Open questions

- `renew.ts:148`: `newId` uses `mission-${Date.now()}-${randomUUID().slice(0,8)}`. The UUID slice to 8 hex chars gives ~4 billion values but `Date.now()` prefix provides effective uniqueness. No collision risk in practice, but a full UUID (like rewind checkpoint pattern) would be cleaner.
- `setup.ts:73 applyMissionPatch` does a `capital_source_json` merge (line 92–94) to avoid losing fields on partial update — `type` and `amount` are stored in the same JSONB object but may be written by separate tool calls. This merge is load-bearing: if a caller sets only `startingCapital`, the existing `capitalSource` (`type`) is preserved. The inverse (`type` update without `amount`) is handled symmetrically. This is correct but subtle — document if widening `capital_source_json` shape.
- `restore.ts`: `RESTORE_LEASE_TTL_MS = 30_000` — restore is DB-only and typically fast, but if Postgres is slow (busy compaction, large archive set) the 30s window could expire before the operation completes. No heartbeat for restore lease. Low risk for current use; flag if restore operations on large sessions become slow.
- `stop-contract.ts:100 normalizeStopConditionReason`: fuzzy text matching is order-sensitive and keyword-based. If user writes creative stop conditions ("if AAPL drops below $100") none of the patterns match and `authorizeMissionStopReason` will reject the stop. No fallback to `no_viable_opportunity` or similar. This may produce unexpected `not authorized` outcomes. Acceptable for MVP; a future improvement would surface the unmapped condition to the model in the stop authorization error.
