# Engine Layer — Echo Agent

> Shared engine-core for chat, mission, and subagent sessions. Two-phase missions (setup → run), three loop modes (off/restricted/full), approval resume, compaction continuity, hierarchical prompt stack.
>
> **Last updated: 2026-03-29**

---

## Session Axes

Two independent axes determine engine behavior:

| Axis | Values | Purpose |
|------|--------|---------|
| `sessionKind` | `chat`, `mission` | What kind of session |
| `loopMode` | `off`, `restricted`, `full` | How much autonomy |

Key combinations:
- `chat + off` — standard chatbot, respond to user messages
- `mission + off` — mission setup (guided draft, no autonomous loop)
- `mission + restricted` — autonomous execution with approval gates for mutations
- `mission + full` — full autonomy, stop only on stop conditions

**Critical distinction:** turn-loop uses `missionRunId` (not `sessionKind`) to decide autonomy. Mission setup has `sessionKind=mission` but `missionRunId=null` → text ends the turn (like chat). Mission run has both → text triggers internal continue.

## Mission Lifecycle

```
draft → ready → running → completed / failed / cancelled
```

- **draft** — user and model collaboratively fill out mission contract via guided setup. `processMissionSetupTurn()` auto-creates draft if none exists.
- **ready** — all 10 required fields populated. Validator is sole source of truth.
- **running** — autonomous execution against frozen contract
- **completed** — business stop (goal_reached, capital_depleted, etc.) via `mission_stop` tool
- **failed** — runtime stop (iteration_limit, timeout, system_error)
- **cancelled** — user_stopped

## Architectural Decisions

1. **`runtime_state` = global process state** — singleton for main loop activity. Per-run state lives in `mission_runs`.
2. **`messages_archive` synchronized** — ALTER on `messages` requires identical ALTER on `messages_archive`.
3. **Repo = persistence only** — `missions.ts` repo is pure CRUD. Validation lives in `mission/validator.ts`.
4. **`session_links` is the only relationship graph** — no `parent_run_id`. Subagent relationships via `session_links`.
5. **Mission patch parser** — model output treated as `unknown`, validated/sanitized before DB write.
6. **Protocol prompts from manifests** — `prompts/protocols.ts` auto-generates from `PROTOCOL_TOOLS` catalog.
7. **Approval enqueued by engine** — turn-loop creates `approval_queue` row with generated `approvalId`. Resume uses `approvalId`, not `toolCallId`. "Awaiting approval" state lives in `approval_queue`, not in messages transcript.
8. **Explicit `updateTokenCount()`** — engine SETs `sessions.token_count` after every inference round-trip (not cumulative — stores latest prompt size). Checkpoint evaluates `tokenCount ≥ contextLimit * 0.9`.
8a. **Deferred assistant save** — `executeTurn()` does NOT save the assistant message. Turn-loop determines canonical batch prefix (only dispatched calls), then saves. Guarantees: no orphaned tool calls, correct message ordering, 1 tool_result per toolCallId.
9. **Domain vs row model** — `MissionDraft` (camelCase) ↔ `MissionDraftRow` (snake_case), `mapper.ts` converts.
10. **Business stops via `mission_stop` tool** — not text parsing. Model calls `mission_stop(reason, summary)`, tool returns `engineSignal` that turn-loop acts on.
11. **Lifecycle guards** — `startMission()` rejects if active run exists. `resumeMissionRun()` rejects terminal runs.
12. **Subagent lifecycle owned by caller** — `subagent.ts` manages status, runner returns result only. Race guard: skip finalize if already stopped.

## Types

Defined in `engine/types.ts`:

- `SessionKind`, `LoopMode` — session axes
- `MissionStatus`, `MissionRunStatus` — lifecycle states
- `BusinessStopReason`, `RuntimeStopReason`, `StopReason` — why a run stopped
- `MessageSource`, `MessageType`, `MessageVisibility` — message taxonomy
- `MissionDraft` — domain model for mission setup
- `MISSION_DRAFT_REQUIRED_FIELDS` — 10 fields required for draft → ready
- `MissionPatch` — untrusted model output shape
- `EngineContext` — passed to all engine components
- `TurnResult` — returned from engine entry points
- `MessageMetadata` — engine metadata on messages

## Database (002_engine_missions.sql)

| Table | Purpose |
|-------|---------|
| `missions` | Mission contract: goal, constraints, wallets, chains, protocols, risk, stop conditions |
| `mission_runs` | Per-run state: status, loop_mode, iteration_count, stop_reason, checkpoint |
| `messages` (extended) | +source, +message_type, +visibility, +origin_session_id, +subagent_id |
| `messages_archive` (extended) | Same columns as messages — required for archivization |

## Stop Conditions

**Business stops** (terminate run permanently): `goal_reached`, `deadline_reached`, `capital_depleted`, `max_loss_hit`, `no_viable_opportunity`, `user_stopped`

**Runtime stops** (engine-level): `iteration_limit`, `timeout`, `system_error` → mission "failed"

**Runtime pauses** (resumable): `approval_required`, `checkpoint_pause`

Business stops are triggered by the model calling `mission_stop` tool → `engineSignal` → turn-loop stops. Runtime stops evaluated by `evaluateRuntimeStopConditions()`.

`finalizeMissionRunStatus()` in runner.ts maps stop reasons to mission/run DB statuses.

## Mission Validation

Defined in `engine/mission/validator.ts` — **sole source of truth** for draft completeness.

Required fields (10): title, goal, capitalSource, startingCapital, allowedWallets, allowedChains, allowedProtocols, riskProfile, successCriteria, stopConditions. `deadline` is optional.

## Mission Patch Parser

Defined in `engine/mission/patch-parser.ts` — safe boundary between model output and DB.

Pipeline: `parseModelMissionOutput(text)` → `extractMissionPatch(unknown)` → `sanitizePatch()` → `Partial<MissionDraft>` → `mapper.domainToRow()` → `Partial<MissionDraftRow>` → merge `capital_source_json` with existing → `repo.updateDraft()`

## Prompt Stack

Defined in `engine/prompts/`.

### Layers

**Constant** (always present, identical in every mode):
- `base.ts` — identity ("crypto and world-native agent with self-learning"), date, session context, loaded documents
- `tool-usage.ts` — discover/execute contract, 2-step transfer rule, token verification rule (resolve before mutate), portfolio_inspect self-inspection guide
- `protocols.ts` — auto-generated namespace map + families + discovery examples per namespace

**Variable** (per mode):
- `mode.ts` — `off` (passive), `restricted` (approval gates), `full` (autonomous)
- `chat.ts` — standard conversation, no auto-loop
- `mission-setup.ts` — guided draft with current state + missing fields in prompt
- `mission-run.ts` — autonomous execution, instructs model to use `mission_stop` tool
- `subagent.ts` — delegated task, respects parent constraints

### Key Rule

Mode changes policy execution, never the scope of protocol knowledge.

### Protocol Prompt Generation

- Namespace descriptions: handwritten frozen map
- Capability families: auto-generated from `toolId` patterns in manifests
- Discovery examples: handwritten per namespace
- Tool counts + mutating flag: auto from manifests

## Engine Core

Defined in `engine/core/`.

### hydrate.ts

Reconstructs engine state from DB. Uses `getActiveMission()` (excludes terminal missions). `loadedDocuments` populated by caller.

### turn.ts

Single inference round-trip. Does NOT save the assistant message — deferred to turn-loop (canonical batch prefix). Exports `saveAssistantMessage()` for turn-loop use. `logUsage()` + `updateTokenCount()` after every call. `token_count` is SET (not cumulative) — stores latest prompt size for checkpoint pressure evaluation.

### turn-loop.ts

Main engine loop. **Deferred save**: `executeTurn()` does NOT save assistant messages — turn-loop determines the canonical batch prefix (only dispatched calls), then saves assistant + tool results in correct order.

**Invariants**:
- Every toolCall in saved assistant message was actually dispatched
- Each toolCallId has 0 or 1 tool_result in messages (0 = approval pending)
- "awaiting approval" state lives in `approval_queue`, not in messages
- liveMessages always has assistant msg BEFORE tool results

Semantics per iteration:

1. Check `abortSignal` → if aborted → `user_stopped` → break
2. Check runtime stop conditions (iteration_limit, timeout) → break
3. `executeTurn()` → read `tokenCount` from DB (SET, not cumulative — latest prompt size)
4. **toolCalls** → dispatch + collect canonical prefix:
   - `pendingApproval` → enqueue to `approval_queue`, trim batch, **break** (no tool_result for this call in messages)
   - `engineSignal.type === "stop_mission"` → track result, trim batch, **break**
   - OK → track call + result → next call
   - After batch: deferred save assistant[canonical] + tool results
5. **text** → deferred save text-only assistant message
6. **text + checkpoint needed** → compact, update summary for next turns → continue
7. **text + `missionRunId`** → add `[Engine: continue]` → next turn
8. **text + no `missionRunId`** (chat / setup) → **break**

### checkpoint.ts

Compaction when `tokenCount ≥ contextLimit * 0.9`. Summary returned and used in subsequent turns within the same loop (not stale).

### resume.ts

`approveAndResume(approvalId)` → returns `TurnResult`:
1. Atomistic CAS on `approval_queue.id`
2. Dispatch approved tool
3. Save tool result
4. If mission run → lazy import `resumeMissionRun()` → re-enter turn loop

### runner.ts

Entry points:
- `processChatTurn(sessionId, userInput)` — forces `sessionKind=chat, loopMode=off`
- `processMissionSetupTurn(sessionId, userInput)` — auto-creates draft, uses `sessionKind=mission, missionRunId=null`, feeds setup prompt context, applies patch after turn
- `startMission(missionId, loopMode?)` — validate, guard against overlapping runs, freeze, create run, enter turn loop
- `approveAndResume(approvalId)` — approve + resume loop
- `resumeMissionRun(runId)` — guard terminal runs, resume turn loop

## Internal Tools (engine-related)

| Tool | Handler | Purpose |
|------|---------|---------|
| `mission_stop` | `tools/internal/mission.ts` | Model-driven mission stop. Returns `engineSignal` to turn-loop. Guarded: requires active `missionRunId`, excluded for subagents. |
| `portfolio_inspect` | `tools/internal/portfolio-inspect.ts` (router) + `inspect-views/*.ts` | DB-backed self-inspection: 14 views — trading, positions, activity, portfolio families. |
| `subagent_reply` | `tools/internal/subagent.ts` | Parent replies to waiting child request. Resumes child via shared lifecycle helper. Ownership-guarded via `session_links`. |
| `subagent_request_parent` | `tools/internal/subagent.ts` | Child requests parent help. Returns `wait_for_parent` engine signal → pauses child loop. |
| `subagent_report_complete` | `tools/internal/subagent.ts` | Child submits structured final report. Returns `complete_subagent` engine signal → `goal_reached` stop. |

## Subagent Runtime

`engine/subagents/runner.ts`: loads subagent + session via `session_links`, reads parent `loopMode` from DB, respects `allowTrades`, passes `abortSignal` to turn-loop. Uses `loadSubagentConfig()` for max iterations / timeout.

`engine/subagents/relay.ts`: thin delegation to `subagent-messages.ts` — `getMessagesByDirection()`.

`tools/internal/subagent.ts`: lifecycle owner. Race guard: checks current status before overwriting. `success=false` if stopReason is timeout/iteration_limit/system_error.
