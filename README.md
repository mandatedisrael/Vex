# EchoClaw

Native Crypto MCP + Vex Agent core.

## Status

Public npm package with local MCP launcher support. Primary entrypoints:

- `echoclaw echo` — guided local MCP setup + ready AI agent connectors
- `echoclaw-mcp` — direct production MCP server entrypoint
- `echoclaw vex` — reserved for the future VEX runtime

## Quickstart

```bash
npm add -g @echoclaw/echo
echoclaw echo
```

The guided `echo` flow:

- checks local runtime requirements,
- shows which `.env` values are already configured,
- fills bundled MCP defaults required for local bootstrap,
- configures local EVM + Solana wallets,
- starts the bundled local services,
- generates ready connector artifacts for Cursor, Claude Code, Codex, OpenClaw, and a default MCP client.

For npm publish, the package uses a dedicated release build that keeps the CLI fully functional while omitting sourcemaps and TypeScript declaration artifacts from the tarball.

## Structure

```
src/echo-agent/   Core agent: engine, tools, DB, sync, inference, E2E MCP harness
src/tools/        13 protocol SDK clients (khalani, kyberswap, polymarket, jupiter, jaine, slop, chainscan, dexscreener, echobook, 0g-compute, 0g-storage, wallet, slop-app)
src/config/       App config and paths
src/constants/    Chain constants
src/utils/        Shared utilities (logger, http, validation, rate limiting)
src/errors.ts     Error codes and types
```

The E2E stack uses **Docker Model Runner** to host the embedding model. The
default is `ai/embeddinggemma:300M-Q8_0` (768-dim), pinned in `docker-compose.e2e.yml`,
distributed through Docker Hub under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
No HF token required.

Embedding model and dimension are **config-driven** via `EMBEDDING_MODEL` /
`EMBEDDING_DIM` env vars. The DB schema uses `vector` (no typmod), so a future
model swap is a config change + a `make knowledge-reembed` (or export-wipe-import
for different dims) — see "Switching embedding model" below.

### Docker Desktop configuration (required for WSL2 / host access)

Docker Model Runner does **not** expose port `12434` on the host by default — the
endpoint is only reachable from inside containers via `model-runner.docker.internal:80`.
To let the agent (running on the host) reach the embedding endpoint at
`http://localhost:12434`, enable host-side TCP support:

1. Open **Docker Desktop → Settings → AI → AI**
2. Under **Docker Model Runner**:
   - Check **Enable Docker Model Runner**
   - Check **Enable host-side TCP support**
   - Set **Port** to `12434`
3. Click **Apply & restart**

Verify with `make e2e-smoke` — should return `OK: dim=$EMBEDDING_DIM`. Without
this setting `knowledge_write` / `knowledge_recall` fail with `embedding service
unavailable: fetch failed`.

MCP E2E server: `pnpm exec tsx src/echo-agent/e2e/mcp/server.ts`

## Switching embedding model

The schema does NOT lock the vector dimension. `EMBEDDING_MODEL` and `EMBEDDING_DIM`
are config values; the actual response length is what gets stamped on each row's
audit columns at write time, and recall filters on `embedding_model + embedding_dim`.

**Maintenance commands require an explicit `ECHO_AGENT_DB_URL`** — they refuse
to fall back to the dev `echo_agent_test` database, because backing up the
wrong DB is a real data-loss scenario. Source the env once at the start of
your shell session:

```bash
set -a; . docker/echo-agent/.env; set +a
```

There are two operator workflows depending on whether the dim changes:

### Same-dim swap (e.g. Gemma 300M Q8 → Gemma 300M Q4 — both 768 dim)

```bash
set -a; . docker/echo-agent/.env; set +a

# 1. Stop the FULL stack of writers (loop engine, MCP server, internal tools,
#    subagents, any CLI session that might call knowledge_write).
# 2. Update env (only EMBEDDING_MODEL changes; EMBEDDING_DIM stays the same)
#    and re-source the .env file.
# 3. Re-embed in place. The script refuses to run if any row has a different
#    embedding_dim from the configured one, or if runtime_state.active = TRUE.
make knowledge-reembed
# 4. Restart the agent.
```

### Different-dim swap (e.g. Gemma 768 → Qwen3 1024)

```bash
set -a; . docker/echo-agent/.env; set +a

# 1. Take a portable backup. Export is read-only and does NOT require a working
#    embedding provider — it works even if the current model is broken.
make knowledge-export ARGS="--out ~/echoclaw-knowledge-$(date +%Y%m%d).jsonl"

# 2. Stop the agent and wipe the dev DB volume.
docker compose -f docker/echo-agent/docker-compose.dev.yml down -v

# 3. Update env (EMBEDDING_MODEL, EMBEDDING_DIM) and re-source.
$EDITOR docker/echo-agent/.env
set -a; . docker/echo-agent/.env; set +a

# 4. Recreate the stack — schema applies fresh from 001_initial.sql.
docker compose -f docker/echo-agent/docker-compose.dev.yml up -d

# 5. Restore. Each entry is re-embedded locally with the new model. Audit fields
#    (status, valid_from, created_at, updated_at) survive the roundtrip exactly,
#    so invalidated/archived/pinned state is preserved. Idempotent on
#    content_hash — re-running on the same backup is a no-op (zero embed calls).
make knowledge-import ARGS="--in ~/echoclaw-knowledge-...jsonl"
```

**SAFETY (reembed only):** the `runtime_state.active` pre-check is a soft guard
against the loop engine. It is NOT a write lock. The operator MUST stop the full
writer stack before running `knowledge-reembed`, otherwise a race with another
writer can produce silent corruption (row with new content + old embedding).

### Upgrading from a previous version

After pulling a branch that changes the embedding pipeline (specifically, the
"honest provenance" change that stamps `embedding_model` from the provider's
response instead of from the requested env value), restamp the audit columns
ONCE so recall can find pre-upgrade rows:

```bash
set -a; . docker/echo-agent/.env; set +a
make knowledge-reembed ARGS="--force"
```

If your provider returns the same model name it received (typical local Docker
Model Runner setup), this is a no-op safe operation. If your provider aliases
the requested name to a different one, recall will not find pre-upgrade rows
until this is run — they were stamped with the requested name, and recall now
filters on the response name.

If your dev DB volume pre-dates the schema change in this branch, the maintenance
commands will refuse to run with an explicit wipe instruction. You must
`docker compose ... down -v && up -d` once.

## Requirements

- Node >= 22
- pnpm 10+
- Docker Engine >= 4.40 (for E2E tests only)
- Docker Compose >= 2.38.1 (for the `models:` block)
- Docker Model Runner active (`docker model status` should be green)
- Docker Desktop **Settings → AI → AI → Enable host-side TCP support** enabled on port `12434` (WSL2/host access to embedding endpoint)
