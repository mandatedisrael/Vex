# Vex-Agent Deep Audit Plan — 10-Agent Explore Phase

Goal (per Lead Dev): for every module / utility / function in `src/vex-agent/`, answer:
1. **Construction**: is it well-built per the repo rules (10-engineering-standards, 20-typescript,
   60-security, 70-debugging, 80-edge-cases)? Flag dead code, duplication, anti-patterns,
   simplifications, security smells.
2. **Capability inventory**: what does it expose? what does it depend on (in-zone + cross-zone)?
3. **Cross-correlation**: who calls whom; what depends on what (the dependency map the Lead Dev
   asked for — "co z czym koreluje").
4. **vex-app coverage**: for each capability, is it consumed by vex-app correctly? Is it consumed
   at all? If consumed, well-implemented? If missing, list as a gap.

Deliverables (this phase):
- 10 zone reports returned by agents (live in my context for consolidation).
- `VEX-INDEX/Structure-vex-agent.md` — consolidated module-level index with deps + cross-zone links.
- `VEX-INDEX/Audit-vex-agent-quality.md` — flagged quality/security/duplication findings per zone.
- `VEX-INDEX/Audit-vex-agent-vex-app-coverage.md` — per-capability: implemented in vex-app y/n,
  quality if implemented, gaps if not.

Method: 10 Explore agents (read-only, Sonnet) running in parallel. Each agent reads the rules + the
relevant skills, then audits its zone with explicit cross-reference to `VEX-INDEX/Structure.md` (the
durable Stage-1 zone index) and grep into `vex-app/` for consumer sites.

## 10 zones (non-overlapping, complete coverage of `src/vex-agent/`)

| # | Zone path(s) | Scope |
|---|--------------|-------|
| A1 | `engine/core/{turn,turn-loop*,hydrate,context-band,stop-conditions,transcript-integrity,recall-seed,run-tool,tool-output-overflow,operator-instructions}.ts` | Turn loop + iteration helpers + per-turn invariants |
| A2 | `engine/core/runner/**` + `engine/core/approval-runtime*.ts` + `approval-runtime/` + `engine/core/{rewind,resume,reject,approval-intent-preview}.ts` | Run lifecycle (agent/mission/recover/abort/retry) + approval runtime |
| A3 | `engine/{runtime,events,checkpoint,support}/**` + `engine/{ingress,runtime-clock,types,index}.ts` | Lease/status + event spine + checkpoint + barrel |
| A4 | `engine/mission/**` | Mission lifecycle (draft/contract/acceptance/start/restore/renew/diff/stop-contract) |
| A5 | `engine/wake/**` + `engine/subagents/**` + `engine/prompts/**` | Defer/sleep, subagent runtime, prompt assembly |
| A6 | `engine/compact-jobs/**` | Track-1 sync compact + Track-2 chunker worker |
| A7 | `inference/**` | OpenRouter client, provider registry, stream consumer, resilience, config |
| A8 | `tools/{registry,dispatcher,types,taxonomy,risk-level}.ts` + `tools/registry/**` + `tools/internal/**` | Tool system core + internal tools (compact, knowledge, memory, subagent, wallet, inspect-views, loop-defer) |
| A9 | `tools/protocols/**` | External protocol tools (dexscreener, kyberswap, khalani, polymarket, solana-jupiter, embeddings, runtime, capture, navigation) |
| A10 | `db/**` + `memory/**` + `knowledge/**` + `sync/**` + `embeddings/**` + `scripts/**` + `public/**` | Data layer + memory/knowledge/sync/embeddings + scripts |

## Agent brief (common preamble — all 10)

- Read-only Explore; no edits, no build/test runs.
- Read rules: `.claude/rules/{00-core-operating-rules,10-engineering-standards,20-typescript,60-security-and-dependencies,70-debugging-observability,80-edge-cases}.md`.
- Read `.claude/skills/vex-platform-architecture/SKILL.md` + ONE zone-specific skill.
- Pre-existing repo-wide index: `VEX-INDEX/Structure.md` (read first). Stage-1 high-level index
  already covers each zone briefly — your job is DEEPER: every module + utility + key function.
- Output format (see template below) — dense, file:line anchors, no full file dumps.
- For vex-app coverage: grep `vex-app/src/` for consumers of the zone's exports (e.g.
  `grep -rn "@vex-agent/<zone>" vex-app/src` and `from "@vex-agent/.../<file>.js"`). For each
  capability, state: consumed-in-vex-app? where? quality concerns? missing wiring?

## Output template (each agent)

```
## Zone <A#>: <name>
### Directory map (compact)
### Module-level inventory
For each notable file: `path:line` — purpose — key exports — invariants/contracts.
### Capabilities (what this zone DOES)
Bulleted list of capabilities (each with the file:line implementing it).
### Cross-zone dependencies
- Imports FROM (which zones / `@vex-lib` / external).
- Consumed BY (which zones / vex-app paths — with `vex-app/src/...` anchors).
### Construction quality (per rules)
For each finding cite the rule + file:line. Categories:
- correctness / invariants
- type-safety / anti-patterns
- security / secret handling
- duplication / dead code / simplification
- error-handling / observability / cleanup
### vex-app coverage matrix
For each capability listed above:
- implemented in vex-app? y/n  
- if y: anchor in vex-app/src/... + brief quality note
- if n: gap (severity: blocker / important / nice-to-have)
### Open questions / things to verify next stage
```

## Consolidation (my work after agents return)

1. Merge zone reports → `Structure-vex-agent.md` (the module-level index of vex-agent).
2. Extract construction findings → `Audit-vex-agent-quality.md` (deduplicated, ranked by severity).
3. Extract coverage matrices → `Audit-vex-agent-vex-app-coverage.md` (capability × implemented? + gaps).
4. Update `00-PROGRESS.md` with headline findings + propose any new harness fixes.

Model choice: **Sonnet for indexing/auditing** (mechanical: read + apply rule heuristics + grep);
**Opus (me) for consolidation** (cross-reference reasoning + ranking). Same split as Stage 1.
