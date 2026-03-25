# Echo Agent — Test Suite Documentation

> Status: **439 tests, 34 files, 0 failures**
> Last full rewrite: 2026-03-25
> Framework: Vitest 4.1.1, Node.js ESM

---

## Overview

This test suite covers the entire `src/agent/` module — the core runtime of EchoClaw, an autonomous AI agent for crypto portfolio management across 0G Network, Solana, and 18 EVM chains.

All tests were written from scratch on 2026-03-25 as a complete replacement of the previous suite (44 files). The rewrite addressed critical coverage gaps in the engine inference loop, internal tool dispatch, echo-loop phased autonomy, session management, provider layer, and security enforcement.

---

## Architecture

```
src/__tests__/agent/
├── _fixtures.ts                  # Shared factory functions (no tests)
├── prompts/                      # Prompt template tests
│   ├── behavior.test.ts
│   ├── compaction.test.ts
│   ├── loop-phases.test.ts
│   └── system.test.ts
├── providers/                    # Inference provider tests
│   └── registry.test.ts
├── telegram/                     # Telegram integration tests
│   └── formatter.test.ts
└── *.test.ts                     # Core module tests (28 files)
```

### Mock Strategy

- **Universal mocks**: `utils/logger.js` (no-op) and `db/client.js` (vi.fn) in every file that touches DB
- **ESM pattern**: `vi.mock()` at top level → `await import()` for module under test (required for Vitest ESM hoisting)
- **Shared fixtures** (`_fixtures.ts`): Factory functions for all domain types — `mockSession()`, `mockInferenceConfig()`, `mockMessage()`, `mockToolCall()`, `mockTradeEntry()`, etc.
- **Behavior-focused**: Tests assert on observable outcomes, not implementation details

---

## Test Inventory (2026-03-25)

### Tier 1 — Pure Functions (0 external mocks)

| File | Module | Tests | What it covers |
|------|--------|------:|----------------|
| `context.test.ts` | `context.ts` | 27 | Token estimation (empty/code/prose), `calculateBudget` (threshold logic), `calculateHybridBudget` (snapshot + delta), `parseCompactionResult` (section extraction) |
| `tool-parser.test.ts` | `tool-parser.ts` | 10 | `sanitizeContent` — strips `<tool_call>` tags, fenced blocks, orphan tags, `</think>` artifacts |
| `validation.test.ts` | `validation.ts` | 35 | All 5 request parsers: `parseChatRequest`, `parseApproveRequest`, `parseToggleTaskRequest`, `parseTelegramConfigRequest`, `parseLoopStartRequest` — happy path, invalid input, boundary values |
| `id.test.ts` | `id.ts` | 5 | `generateId` prefix format, UUID pattern, uniqueness guarantee |
| `resilience.test.ts` | `resilience.ts` | 21 | `retryWithBackoff` (success/retry/exhaust/shouldRetry/maxDelay/logging), `withTimeout` (fast/slow), `isRetryableError` (5xx/429/4xx/abort/transport) |
| `rate-limit.test.ts` | `rate-limit.ts` | 12 | `checkRateLimit` (within/exceed/reset/IP-independent/endpoint-independent), `getClientIp` (localhost trust/external ignore) |
| `session-lock.test.ts` | `session-lock.ts` | 6 | `withSessionLock` serialization (same session), parallelism (different sessions), error recovery, cleanup |
| `types.test.ts` | `types.ts` | 5 | `toChatMode` runtime guard — valid modes, invalid string, non-string fallback |

**Subtotal: 121 tests**

### Tier 2 — Core Business Logic (mock DB only)

| File | Module | Tests | What it covers |
|------|--------|------:|----------------|
| `executor.test.ts` | `executor.ts` | 24 | `executeTool` (success/fail/timeout/--json/--yes logic), `redactArgs` (sensitive flags), `shellSplit` (quotes/spaces), `isMutatingCommand` |
| `tool-registry.test.ts` | `tool-registry.ts` | 19 | Registry integrity (14+ internal tools, no duplicates), `getToolDef`, `isInternal`, `isMutating`, `supportsYes`, `toOpenAITools` (mode filtering, proactive flag) |
| `trade-capture.test.ts` | `trade-capture.ts` | 28 | `detectCapturedTradeCommand` (16 commands, longest-prefix matching), `deriveTradeIdFromTrade` (SHA-1 deterministic ID), `captureTradeFromResult` (solana swap/predict/khalani bridge/kyber/jaine/slop/MEV claim, failure filtering, dryRun guard) |
| `autonomy-inbox.test.ts` | `autonomy-inbox.ts` | 15 | `publish` (fire-and-forget), `consumeAll` (atomic consume, error recovery), `peek`, `formatEventsForContext` (all event types, markers) |
| `billing.test.ts` | `billing.ts` | 9 | `getProviderBalance` (delegate/null), `recordBillingSnapshot`, `getBillingState` (full assembly, zero-division guard, null provider) |
| `portfolio-chains.test.ts` | `portfolio-chains.ts` | 12 | `normalizePortfolioChain` (sol/0g/numeric/unknown), `resolvePortfolioChainName`, `getDefaultTrackedChains` (includes 0g+solana+kyber, no duplicates) |
| `snapshot.test.ts` | `snapshot.ts` | 6 | `takeSnapshot` — EVM decimals, Solana parsing, NaN guard, P&L calculation, CLI failure graceful degradation, 0G native fallback |

**Subtotal: 113 tests**

### Tier 3 — Session & Provider Layer

| File | Module | Tests | What it covers |
|------|--------|------:|----------------|
| `session-hydrate.test.ts` | `session-hydrate.ts` | 8 | `hydrateSession` — valid/not found/compacted/engine not ready, knowledge rebuild from `file_read` tool calls, snapshot seeding, dedup |
| `session-manager.test.ts` | `session-manager.ts` | 8 | `createNewSession` (no prev/with prev/summary fails/engine not ready/scope), `buildOvernightDigest` (formatted report/missing/error) |
| `providers/registry.test.ts` | `providers/registry.ts` | 9 | `resolveProvider` (explicit env/openrouter key/0g fallback/unknown/error), `getActiveProvider` cache, `resetProvider` |
| `inference.test.ts` | `inference.ts` | 9 | `loadInferenceConfig`, `inferWithTools` (SDK path/raw fetch/native tool_calls/malformed args skip/all-malformed fallback), `inferNonStreaming` (SDK/raw fetch) |

**Subtotal: 34 tests**

### Tier 4 — Orchestrators

| File | Module | Tests | What it covers |
|------|--------|------:|----------------|
| `engine.test.ts` | `engine.ts` | 13 | `initEngine`, `createSession`, `processMessage` (text/tool routing/internal vs CLI/inference failure/usage tracking/low balance), `resumeAfterApproval` (execute/trade capture/capture failure tolerance) |
| `internal-tool-handlers.test.ts` | `internal-tool-handlers.ts` | 31 | `processInternalTools` dispatch + all 15 handlers: file_write (knowledge/soul/path traversal), file_read (load/preview/not found), file_delete (cleanup/traversal block), memory_update/manage (list/append/replace/delete/unknown action), web_search/fetch (query/URL validation), trade_log (valid/incomplete/JSON parse), subagent_spawn/status/stop |
| `echo-loop.test.ts` | `echo-loop.ts` | 8 | start/stop/isLoopRunning, session create/restore, phase execution (full chain/quiet short-circuit), inbox event injection in sense phase |
| `echo-papa.test.ts` | `echo-papa.ts` | 10 | `runEchoPapaCycle` — agent not ready, text-only response, tool call loop, **safety rules**: whitelist enforcement, soul.md protection, must-read-before-delete, recency guard, inference error handling, report writing, max iterations |
| `subagent.test.ts` | `subagent.ts` | 7 | `spawnSubagent` (success/concurrency limit/name duplicate/engine not ready), `getSubagentStatus`, `recoverOrphanedSubagents` |
| `topup-monitor.test.ts` | `topup-monitor.ts` | 10 | start/stop idempotency, `checkBalance` (no config/non-0G/not low/low→event/cooldown/recovery/DB error), `onTopupSuccess` |

**Subtotal: 79 tests**

### Tier 5 — Supporting Modules

| File | Module | Tests | What it covers |
|------|--------|------:|----------------|
| `search.test.ts` | `search.ts` | 7 | `webSearch` (cache hit/no API key/Tavily call+cache/error), `webFetch` (cache hit/extract+cache/simple fetch fallback) |
| `tools.test.ts` | `tools.ts` | 7 | `buildSystemPrompt` — soul/memory/mode description/first conversation fallback/date/loaded knowledge/subagent skill gating |
| `routes.test.ts` | `routes.ts` | 6 | `registerRoute`+`dispatchRoute` (match/404/path params/query stripping), `jsonResponse`, `errorResponse` |
| `compose.test.ts` | `compose.ts` | 13 | `getAgentImage` (env override/constructed), `getAgentComposeEnv` (includes/overrides), `getAgentComposeArgs` (flags/build override), `getAgentComposeFailureInfo` (generic/release issue), `getAgentUrl` |

**Subtotal: 33 tests**

### Tier 6 — Prompts

| File | Module | Tests | What it covers |
|------|--------|------:|----------------|
| `prompts/system.test.ts` | `prompts/system.ts` | 9 | `getModeDescription` (off/restricted/full), `buildCurrentDateSection` (ISO date/weekday), `buildLoadedKnowledgeSection` (empty/single/multiple) |
| `prompts/behavior.test.ts` | `prompts/behavior.ts` | 4 | `getBehaviorInstructions` — core behavior present in all modes, manual override, autonomous behavior |
| `prompts/compaction.test.ts` | `prompts/compaction.ts` | 7 | `getCompactionSystemPrompt`, `buildCompactionPrompt` (transcript/system exclusion/file paths/no files/truncation/section headers) |
| `prompts/loop-phases.test.ts` | `prompts/loop-phases.ts` | 11 | `buildPhasePrompt` per phase (sense/assess/decide/execute/verify/journal/idle/sleep), previous output prepending, `buildScheduledAlertPrompt` |

**Subtotal: 31 tests**

### Tier 7 — Telegram

| File | Module | Tests | What it covers |
|------|--------|------:|----------------|
| `telegram/formatter.test.ts` | `telegram/formatter.ts` | 28 | `markdownToTelegramHtml` (bold/italic/code/pre/strikethrough/links/headers/lists/HTML escape/code safety), `formatToolStart`, `formatApprovalMessage`, `formatSubagentSpawned/Completed`, `formatLoopPhase`, `formatTopupEvent` (succeeded/failed/critical), `chunkMessage` |

**Subtotal: 28 tests**

---

## Security Coverage

| Area | Tests | What is verified |
|------|-------|-----------------|
| **Executor redaction** | `executor.test.ts` | `--private-key`, `--token`, `--mnemonic`, `--api-key`, `--password`, `--seed` values never appear in logs |
| **Rate limit trust** | `rate-limit.test.ts` | `x-forwarded-for` trusted only from `127.0.0.1`/`::1`/`::ffff:127.0.0.1`, ignored from external IPs |
| **Path traversal** | `internal-tool-handlers.test.ts` | `file_write` and `file_delete` block `..` paths (except `../soul.md` for write) |
| **Echo Papa safety** | `echo-papa.test.ts` | Tool whitelist enforcement, `soul.md` protection, must-read-before-delete, recency guard (5min), active trade position protection |
| **Input validation** | `validation.test.ts` | All 5 parsers reject missing/malformed/out-of-range values with `RequestValidationError` |
| **Inference defense** | `inference.test.ts` | Malformed `tool_call` arguments skipped (not propagated), all-malformed falls through to text |
| **Provider fail-fast** | `providers/registry.test.ts` | Unknown `AGENT_PROVIDER` returns null (not silent fallback) |
| **Trade filtering** | `trade-capture.test.ts` | `success: false`, `dryRun: true`, non-JSON output all return empty (no phantom trades) |

---

## Running Tests

```bash
# All agent tests
pnpm test -- src/__tests__/agent/

# Single file
pnpm test -- src/__tests__/agent/engine.test.ts

# Watch mode
pnpm test:watch -- src/__tests__/agent/

# Verbose output
npx vitest run --reporter=verbose src/__tests__/agent/
```

---

## Writing New Tests

### Pattern

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockSession, mockInferenceConfig } from "./_fixtures.js";

// 1. vi.mock() calls FIRST (hoisted by Vitest)
vi.mock("../../agent/db/client.js", () => ({
  query: vi.fn(), queryOne: vi.fn(), execute: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// 2. Dynamic import AFTER mocks (required for ESM)
const { functionUnderTest } = await import("../../agent/module.js");

// 3. Tests
beforeEach(() => { vi.clearAllMocks(); });

describe("functionUnderTest", () => {
  it("describes the behavior, not the implementation", async () => {
    // Arrange → Act → Assert
  });
});
```

### Conventions

- **File naming**: `{source-module}.test.ts` matching the source file name
- **Describe blocks**: Exported function/class name
- **It descriptions**: Start with verb, describe behavior — `"returns null when session is compacted"` not `"checks existing.compacted"`
- **Fixtures**: Use factory functions from `_fixtures.ts` — no magic values
- **Cleanup**: `beforeEach(() => vi.clearAllMocks())` in every describe block
- **No `any`**: Use `as unknown as Type` for mock casts when needed

---

## Not Covered (known gaps as of 2026-03-25)

These modules have no dedicated test files. They are either thin wrappers, config-only, or require integration-level testing:

| Module | Reason |
|--------|--------|
| `server.ts` | HTTP server startup — requires integration test with real HTTP |
| `scheduler.ts` | Complex cron + node-cron dependency — partially tested via `echo-loop` and `engine` |
| `providers/openrouter.ts` | SDK wrapper — requires mocking `@openrouter/sdk` constructor chain |
| `providers/0g-compute.ts` | Broker SDK wrapper — requires mocking `getAuthenticatedBroker` |
| `docker-check.ts` | System-level Docker detection — requires real Docker or heavy mocking |
| `polymarket-live.ts` | WebSocket singleton — requires WS mock infrastructure |
| `predictions.ts` | Thin aggregator over external prediction services |
| `telegram/bridge.ts` | Wires grammy to engine — integration-level |
| `telegram/commands.ts` | grammy command handlers — integration-level |
| `telegram/poller.ts` | grammy Bot lifecycle — integration-level |
| `telegram/approval-handler.ts` | InlineKeyboard callbacks — grammy-specific |
| `db/repos/*.ts` (14 files) | SQL query wrappers — always mocked; testing them requires real Postgres |
| `handlers/*.ts` (14 files) | HTTP handlers — require integration tests with mock req/res |
| `cli-tool-defs.ts` | Empty array (discover+execute migration in progress) |

These gaps are tracked for future work. Priority: `scheduler.ts`, `handlers/chat.ts`, provider adapters.
