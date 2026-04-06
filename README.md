# EchoClaw

Native Crypto MCP + Vex Agent core.

## Status

`private` / pre-MCP / internal dev-only. No public entrypoint yet.

## Structure

```
src/echo-agent/   Core agent: engine, tools, DB, sync, inference, E2E MCP harness
src/tools/        13 protocol SDK clients (khalani, kyberswap, polymarket, jupiter, jaine, slop, chainscan, dexscreener, echobook, 0g-compute, 0g-storage, wallet, slop-app)
src/config/       App config and paths
src/constants/    Chain constants
src/utils/        Shared utilities (logger, http, validation, rate limiting)
src/errors.ts     Error codes and types
```

## Development

```bash
pnpm install
pnpm run build      # tsc + tsc-alias
pnpm run dev        # tsc --watch
```

## Testing

```bash
pnpm test           # vitest — all retained suites
make lint           # tsc --noEmit (includes tests)
make check          # lint + test
```

## E2E (requires Docker + Docker Model Runner)

```bash
make e2e-up         # start pgvector Postgres on port 5777 + pull EmbeddingGemma model
make e2e-down       # stop
make e2e-smoke      # POST /v1/embeddings against the local Model Runner (returns 768-dim vector)
```

The E2E stack uses **Docker Model Runner** to host `ai/embeddinggemma:300M-Q8_0`
on the fixed runner port `12434`. No HF token required — the model is distributed
through Docker Hub under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).

MCP E2E server: `pnpm exec tsx src/echo-agent/e2e/mcp/server.ts`

## Requirements

- Node >= 22
- pnpm 10+
- Docker Engine >= 4.40 (for E2E tests only)
- Docker Compose >= 2.38.1 (for the `models:` block)
- Docker Model Runner active (`docker model status` should be green)
