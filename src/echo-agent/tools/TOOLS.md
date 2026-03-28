# Tools Layer — Echo Agent

Everything the LLM can call. Two systems: **internal tools** (handled in-process) and **protocol tools** (via discover+execute meta-tools).

## Architecture

```
tools/
  types.ts            — ToolDef, ToolCallRequest, ToolResult, OpenAITool
  registry.ts         — All tool definitions + registry API (getToolDef, isInternalTool, getOpenAITools)
  dispatcher.ts       — Routes every LLM tool call: protocol meta-tools or internal handlers
  internal/           — In-process handlers (web, documents, memory, schedule, subagent, wallet)
  protocols/          — discover_tools + execute_tool system (10 protocol namespaces, 200+ tools)
```

## How a tool call flows

```
LLM → tool_call(name, args)
  → dispatcher.dispatchTool(call, context)
    → if "discover_tools" or "execute_tool" → protocols/runtime.ts
    → if internal tool → lazy-import handler from internal/
    → else → "Unknown tool" error
  → ToolResult → back to LLM
```

## Internal tools

Defined in `registry.ts`. Each handler is a pure `(params, context) → ToolResult` function. No DB writes to session messages, no SSE events — the engine handles that.

| Tool | Handler file | What it does |
|------|-------------|--------------|
| `discover_tools` | `protocols/runtime.ts` | Search protocol capabilities by query/namespace |
| `execute_tool` | `protocols/runtime.ts` | Execute a discovered protocol tool by toolId |
| `web_search` | `internal/web.ts` | Tavily search with Postgres cache (15min TTL) |
| `web_fetch` | `internal/web.ts` | Tavily extract + HTTP fallback, cached (1h TTL) |
| `document_read` | `internal/documents.ts` | Read document from DB, preview or full context load |
| `document_write` | `internal/documents.ts` | Create/update document (auto-creates folders) |
| `document_list` | `internal/documents.ts` | List documents and folders in a space |
| `document_delete` | `internal/documents.ts` | Soft-delete (archive) a document |
| `memory_manage` | `internal/memory.ts` | CRUD on persistent memory entries (list/append/replace/delete) |
| `schedule_create` | `internal/schedule.ts` | Create cron task (tool_call/wake_agent/reminder/monitor/snapshot/backup) |
| `schedule_remove` | `internal/schedule.ts` | Remove a scheduled task |
| `subagent_spawn` | `internal/subagent.ts` | Spawn background subagent (fire-and-forget) |
| `subagent_status` | `internal/subagent.ts` | Check subagent progress/results |
| `subagent_stop` | `internal/subagent.ts` | Stop a running subagent |
| `wallet_read` | `internal/wallet.ts` | Wallet address + multi-chain balances via Khalani |
| `wallet_send_prepare` | `internal/wallet.ts` | Prepare transfer intent (no broadcast) |
| `wallet_send_confirm` | `internal/wallet.ts` | Sign + broadcast transfer (mutating, needs approval) |

## internal/types.ts — shared contract

```typescript
// Context passed to every internal handler
interface InternalToolContext {
  sessionId: string;
  loadedDocuments: Map<string, string>;  // documents currently in LLM context
  loopMode: "full" | "restricted" | "off";
  approved: boolean;
}

// Param helpers
str(params, key)   → string (safe accessor)
num(params, key)   → number | undefined
bool(params, key)  → boolean

// Result helpers
ok(data)    → { success: true, output: JSON.stringify(data), data }
fail(msg)   → { success: false, output: msg }
```

## Protocol tools

10 namespaces, 200+ tools. LLM accesses them via two meta-tools:

1. `discover_tools` — search manifests by query/namespace, get toolId + params + description
2. `execute_tool` — call handler by toolId with params, runtime validates + executes

```
protocols/
  types.ts       — ProtocolToolManifest, ProtocolHandler, ProtocolDiscoveryResult
  catalog.ts     — All manifests + handlers registered here
  runtime.ts     — discover + execute logic + execution capture hook
  khalani/       — 9 tools: bridge, balances, orders, chains, tokens
  solana-jupiter/— 37 tools: swap, perps, predict, DCA, limit, lend, stake, history, studio
  kyberswap/     — 16 tools: swap, limit orders (maker+taker), zap LP, chains, tokens
  polymarket/    — 69 tools: bridge, CLOB trading, data/positions, gamma discovery
  dexscreener/   — 11 tools: search, pairs, trending, orders (all read-only)
  0g/chainscan/  — 17 tools: account, transaction, contract, decode, token, stats
  0g/jaine/      — 15 tools: pools, swap (buy+sell), allowance, w0g wrap
  0g/slop/       — 11 tools: token create/info, trade buy/sell, curve, fees, rewards
  echobook/      — 28 tools: posts, comments, profile, social, submolts, points
  0g/slop-app/   — 8 tools: profile, image upload/generate, agents, chat
```

### Execution capture

Every mutating protocol tool call (success AND failure) is captured to `protocol_executions`. Extracts:

- `trade_capture` — from `_tradeCapture` in handler result data
- `external_refs` — canonical keys (`txHash`, `orderId`, `positionPubkey`, `orderKey`, `conditionId`, `signature`) extracted from handler result

This feeds the execution → sync → projection pipeline (see `db/DB.md` and `sync/SYNC.md`).

## Key differences from legacy src/agent/

| Aspect | Legacy (src/agent/) | Echo Agent (src/echo-agent/) |
|--------|--------------------|-----------------------------|
| File tools | `file_read/write/list/delete` on `knowledge_files` | `document_read/write/list/delete` on `folders` + `documents` |
| Schedule types | `cli_execute`, `inference`, `alert` | `tool_call`, `wake_agent`, `reminder`, `monitor` |
| Trade logging | Manual `trade_log` tool | Auto-captured via `_tradeCapture` in protocol handlers |
| Session relations | `parent_session_id` on sessions + subagents | `session_links` table (canonical) |
| Context tracking | `loadedKnowledge: Map<string, string>` | `loadedDocuments: Map<string, string>` |
| DB layer | Imports from `src/agent/db/repos/` | Own repos in `src/echo-agent/db/repos/` |
