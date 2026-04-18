# Echo-Agent Audit Inventory

Status: draft for milestone `echo-agent audit` (PR1–PR5).
Generated: 2026-04-18 (post-PR4 `77b9c20`).
Source of truth for classification decisions across the milestone. Each subsequent PR references rows by `path`.

Classification vocabulary:

- `runtime` — executed on the agent runtime path (turn-loop, checkpoint, dispatch, recall).
- `reserved` — declared but intentionally dormant (placeholder namespace, reserved type state). Must be explicitly named, not silently dead.
- `operator-only` — maintenance/ops tool run by a human or CI, not the runtime.
- `benchmark` — reproducible measurement scaffolding.
- `demo` — illustrative scripts, not production.
- `fixture` — static data used by tests or scripts.
- `orphan` — zero referenced by runtime, operator-only, benchmark, demo, test, or packaging. Deletion candidate after global grep.

## 1. Assets and dead-code candidates

| Path | Status | Evidence | Action |
|------|--------|----------|--------|
| `src/echo-agent/public/*` (9 assets) | reserved-for-future | Zero repo references (grep negative), not in `package.json#files`. **User decision 2026-04-18: retain — reserved na przyszłe użycie (potencjalnie frontend / desktop shell per `vex_desktop_bottlenecks` plan).** | **KEEP.** PR5 SKIPS deletion. Future refactor (move to `src/mcp/public/` or dedicated app) is OK; delete is not. |
| `src/echo-agent/sync/replay.ts` (`replayProjections`) | operator-only | `grep -rn "replayProjections\|replay-projections" /mnt/x/EchoClaw/src/` → only self-reference; no runtime import, no test, no `package.json` script. | Move to `src/echo-agent/scripts/ops/replay-projections.ts` + add `package.json` script in PR5. Add operator-only comment header. |
| `ToolLifecycle = "declared"` variant (`src/echo-agent/tools/protocols/types.ts`) | orphan (type state) | `grep -rn 'lifecycle:\s*"declared"' /mnt/x/EchoClaw/src/` → 0 hits. No manifest uses it. | Remove from `ToolLifecycle` union in PR1 §1c. Does NOT remove public `includeDeclared` parameter (separate concern, §1e). |
| `includeDeclared` parameter (previously in `tools/registry/protocol.ts`, `tools/protocols/types.ts`, `tools/protocols/discovery.ts`, `tools/protocols/discovery.telemetry.ts`, `tools/dispatcher.ts`) | removed (PR1) | After `ToolLifecycle` was narrowed to `"active"`, the flag had literally zero runtime effect. Keeping it as deprecated no-op would have forced future reviewers to ask "when does this go" — dead surface is itself tech debt. MCP clients that still pass the flag get silent-strip from Zod default-parsing (no visible error). | DONE in PR1: removed from public schema, internal type, dispatcher forwarding, discovery branch, and telemetry field. Reintroduction requires a concrete new lifecycle variant + real manifests using it. |
| `src/echo-agent/tools/protocols/navigation/entries-reserved.ts` — namespace `0g-compute` | reserved (collision with inference provider `inference/0g-compute.ts`) | `src/echo-agent/inference/0g-compute.ts` is an inference provider; `entries-reserved.ts:5` declares a reserved protocol namespace with same string label, zero handlers, `advertised: false`. Dual-purpose label is a grep trap for onboarding. | Rename reserved namespace label to `"0g-compute-reserved"` in PR5 §5e (zero handlers → cosmetic, zero runtime impact). Alternative: document collision here and leave — builder decides at PR5 time. |
| `src/echo-agent/tools/protocols/navigation/entries-reserved.ts` — namespace `0g-storage` | reserved | Placeholder for future 0G Storage protocol; `advertised: false`, zero handlers. No current collision. | Keep. Document as intentional reserved in this inventory. |

## 2. Operator-only scripts

All live in `src/echo-agent/scripts/`. `package.json` `scripts` field exposes them via `pnpm`. Not counted toward runtime LOC limit.

| Path | Status | `package.json` entry | Notes |
|------|--------|----------------------|-------|
| `src/echo-agent/scripts/_preflight.ts` | operator-only (shared) | (used by siblings) | DB URL + schema preflight helpers. |
| `src/echo-agent/scripts/knowledge-import.ts` + `scripts/knowledge-import/**` | operator-only | `knowledge-import` | Backup restore. PR5 may move to `scripts/ops/`. |
| `src/echo-agent/scripts/knowledge-export.ts` | operator-only | `knowledge-export` | Backup export. PR5 may move to `scripts/ops/`. |
| `src/echo-agent/scripts/knowledge-reembed.ts` | operator-only | `knowledge-reembed` | Maintenance lease holder (§PR4 from vex_simplified_gate). PR5 may move to `scripts/ops/`. |
| `src/echo-agent/scripts/checkpoint-compliance-check.ts` | operator-only | `checkpoint-compliance` | 614 LOC — NOT counted toward runtime limit. Out of scope for refactor. |
| `src/echo-agent/scripts/checkpoint-compliance-fixtures.ts` | fixture | (imported by check script) | Static test corpus for compliance CLI. |
| `src/echo-agent/scripts/session-recall-demo.ts` | demo | (none) | 582 LOC demo of recall path — NOT counted. |
| `src/echo-agent/scripts/cross-lingual-benchmark.ts` | benchmark | (none) | 502 LOC — benchmark scaffolding. |
| `src/echo-agent/scripts/cross-lingual-benchmark-dataset.ts` | fixture | (imported by benchmark) | 431 LOC static dataset. |

Recommended PR5 reorganization (optional, low priority):

```
src/echo-agent/scripts/
  ops/          # knowledge-*, checkpoint-compliance-check, replay-projections
  benchmarks/   # cross-lingual-benchmark*
  demos/        # session-recall-demo
```

## 3. Runtime hotspots (exceed team-agreed 300/400 LOC threshold)

Counted toward LOC limit. Post-PR4 state.

| Path | LOC | Status | Planned action |
|------|-----|--------|----------------|
| `src/echo-agent/db/repos/session-episodes.ts` | 482 | runtime — **HARD limit** | Split in PR2 §2b (types / crud / recall / promotion-queries + barrel). |
| `src/echo-agent/knowledge/promotion.ts` | 455 | runtime — **HARD limit** (PR4 addition) | Split in PR2 §2a (eligibility / translation / persist / orchestrator + barrel). |
| `src/echo-agent/db/repos/knowledge-lifecycle.ts` | 387 | runtime — near soft | Split in PR2 §2c (errors / types / supersede + barrel). |
| `src/echo-agent/inference/openrouter.ts` | 370 | runtime adapter | Keep; PR4 adds adapter-level tests. Not split. |
| `src/echo-agent/engine/checkpoint/extract.ts` | 361 | runtime | Keep; extract prompt is cohesive. Not split. |
| `src/echo-agent/db/repos/sessions.ts` | 357 | runtime | Keep; cohesive repo. Not split. |
| `src/echo-agent/engine/core/checkpoint.ts` | 352 | runtime — NON-GOAL §7.10 | Keep; Phase I/II invariant load-bearing. |
| `src/echo-agent/tools/protocols/0g/jaine/handlers/swap.ts` | 351 | runtime | Keep; cohesive swap handler. |
| `src/echo-agent/tools/protocols/polymarket/handlers-clob.ts` | 351 | runtime | Keep; cohesive CLOB handler. |
| `src/echo-agent/engine/core/turn-loop.ts` | 333 | runtime — critical invariant | Keep; PR4 adds promotion-hook test. |
| `src/echo-agent/tools/protocols/echobook/handlers.ts` | 301 | runtime | Split in PR2 §2d (per-domain handler files + barrel). |
| `src/echo-agent/tools/protocols/discovery.ts` | 300 | runtime | Keep (at soft limit); PR1 removes `includeDeclared` internal branch → drops below. |

## 4. Follow-up tickets (extracted from plan non-goals §7)

- Extend `ProtocolParamDef` with `enum`/`schema` (option (b) from plan §2.8) — broader contract evolution.
- Full Zod migration for handler readers (replace `str()/num()/bool()`).
- Full Zod schemas on `inference/0g-compute/mappers.ts` response parsing and `sync/lp-economics.ts` GraphQL.
- Rewrite inference provider adapters (`openrouter.ts`, `0g-compute.ts`).
- Native gas reserve backstop (`handler-helpers.ts:52` TODO).
- `validateCaptureContract` fail-open → fail-closed policy change (intentional today; documented in `capture-validator-policy.test.ts`).
- (completed in PR1) `includeDeclared` removed entirely from `discover_tools` schema + internal types.
- Unified DB pool for Agent DB vs echo-agent DB — intentional separation today.
- Generic `sync/` worker + domain projectors migration.
- Refactor `scripts/checkpoint-compliance-check.ts` (614 LOC) — operator CLI, out-of-scope for runtime audit.

## 5. MCP contract surface (do not break)

Imports from `@echo-agent/*` into `src/mcp/`:

| Symbol | From | Preserved by |
|--------|------|--------------|
| `dispatchTool` | `tools/dispatcher.ts` | PR1 (internal refactor only, signature unchanged). |
| `getProductionMcpTools` | `tools/registry.ts` | PR1 (filtering logic unchanged). |
| `ToolDef`, `JsonSchema`, `OpenAITool`, `toOpenAITools` | `tools/types.ts` | PR1/PR3 (type shape unchanged). |
| `PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST`, `PROTOCOL_NAMESPACE_ALLOWLIST`, `NAMESPACE_DEFAULTS`, `PROTOCOL_TOOLS`, `isAdvertisedProtocolNamespace`, `isKnownProtocolNamespace`, `isProtocolToolAvailable`, `countAvailableToolsForNamespace`, `getMissingEnvForNamespace`, `getProtocolHandler`, `getProtocolManifest`, `NamespaceDefault` | `tools/protocols/catalog.ts` | PR1 (re-exports preserved; internal implementation = per-namespace registry + Map lookup). |
| `ProtocolNamespace`, `ProtocolToolManifest`, `ProtocolHandler`, `ToolLifecycle` | `tools/protocols/types.ts` | PR1 (`ToolLifecycle = "active" | "declared"` → `ToolLifecycle = "active"` after `declared` removal; if any external consumer uses `"declared"`, that's a breaking change — mitigated by grep in PR1). |
| `InternalToolContext` | `tools/internal/types.ts` | stable. |
| `runMigrations`, `getPool`, embedding config, `sessionsRepo.*` | misc | stable. |

Enforcement: `src/__tests__/echo-agent/tools/mcp-contract.test.ts` (Krok 0.2).
