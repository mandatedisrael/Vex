# EchoClaw — Developer Makefile

.PHONY: build test dev clean lint lint-all check e2e-up e2e-down e2e-smoke

# -- Build & Test -------------------------------------------------------------

build:
	pnpm run build

test:
	pnpm test

dev:
	pnpm run dev

clean:
	pnpm run clean

lint:
	pnpm exec tsc --noEmit

lint-all:
	pnpm exec tsc --noEmit -p tsconfig.test.json

check: lint test

# -- E2E Test stack (pgvector + Docker Model Runner) -------------------------
#
# Postgres on host port 5777 (was 5555). EmbeddingGemma on Model Runner port
# 12434 (fixed by the runner). Requires Docker Engine >=4.40, Compose >=2.38.1,
# and Docker Model Runner active (`docker model status`).

e2e-up:
	docker compose -f docker/echo-agent/docker-compose.e2e.yml up -d

e2e-down:
	docker compose -f docker/echo-agent/docker-compose.e2e.yml down

e2e-smoke:
	@echo "Smoke-testing Model Runner embeddings endpoint…"
	@curl -fsS -X POST http://localhost:12434/engines/llama.cpp/v1/embeddings \
	  -H "Content-Type: application/json" \
	  -d '{"input":"ping","model":"ai/embeddinggemma:300M-Q8_0"}' \
	  | jq '.data[0].embedding | length' \
	  | (read dim; if [ "$$dim" = "768" ]; then echo "OK: dim=$$dim"; else echo "FAIL: expected 768, got $$dim"; exit 1; fi)
