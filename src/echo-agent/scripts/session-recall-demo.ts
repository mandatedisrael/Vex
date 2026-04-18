/**
 * session-recall-demo — end-to-end session memory demo against real DB.
 *
 * Simulates a Vex trading/DeFi session: creates a session, inserts 10
 * realistic episodes with real EmbeddingGemma embeddings, then runs several
 * recall queries to show what the multilingual recall path actually returns
 * in production shape.
 *
 * Unlike the synthetic `cross-lingual-benchmark`, this script exercises the
 * WHOLE production path:
 *   - `sessions` table insert + memory_scope_key wire-up
 *   - `session_episodes` INSERT via `insertEpisodes()` (the same repo the
 *     checkpoint flow uses)
 *   - `recallTopK()` with (memory_scope_key, embedding_model, embedding_dim)
 *     filter — mirrors `turn.ts::fetchSessionEpisodeRecallBlock`
 *
 * Episodes are intentionally mixed: most in Polish (session language), two in
 * English (simulating legacy or multi-tenant session mix), across different
 * episode kinds and topics.
 *
 * Queries run afterward include Polish, English, and a mixed/ambiguous case.
 *
 * Usage:
 *   pnpm exec tsx src/echo-agent/scripts/session-recall-demo.ts
 *
 * Required env: same as embeddings (EMBEDDING_BASE_URL, EMBEDDING_MODEL,
 * EMBEDDING_DIM, EMBEDDING_PROVIDER) + ECHO_AGENT_DB_URL.
 *
 * The demo session is NOT deleted automatically. The session id is logged
 * so you can inspect (or drop) manually:
 *   psql $ECHO_AGENT_DB_URL -c "DELETE FROM sessions WHERE id = '<printed-id>';"
 *   (CASCADE drops the episodes too.)
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { closePool } from "@echo-agent/db/client.js";
import { runMigrations } from "@echo-agent/db/migrate.js";
import {
  insertEpisodes,
  recallTopK,
  type EpisodeKind,
  type NewEpisode,
} from "@echo-agent/db/repos/session-episodes.js";
import { createSession, setMemoryScopeKey } from "@echo-agent/db/repos/sessions.js";
import { embedDocument, embedQuery } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import { computeEpisodeHash } from "@echo-agent/engine/checkpoint/extract.js";
import logger from "@utils/logger.js";

// ── Demo dataset ─────────────────────────────────────────────────────

interface DemoEpisode {
  kind: EpisodeKind;
  topic: string;
  /** Short title (≤100 chars) — simulates the LLM-generated title PR2 introduces. */
  title: string;
  /** Body — this is what goes into summary_en (the column). Post-PR2 it's `summary_text`. */
  summary: string;
  /** Arbitrary structured facts — mirrors what extractEpisodes returns. */
  facts?: Record<string, unknown>;
  entities?: string[];
}

/**
 * 10 episodes across a simulated PL session about DeFi trading.
 * Mix of types (decision/fact/preference/lesson/tool_result_summary) and
 * languages (8 PL + 2 EN — the EN ones simulate legacy or imported memory).
 */
const EPISODES: readonly DemoEpisode[] = [
  {
    kind: "fact",
    topic: "balance_solana",
    title: "Sprawdzenie stanu USDC na Solanie",
    summary:
      "User zapytał o stan USDC na Solanie. Agent zgłosił 1250 USDC w portfelu 4QpN...xyz przez narzędzie balance_check. Transakcja potwierdzona w bloku 237819521.",
    entities: ["USDC", "Solana", "4QpN...xyz"],
  },
  {
    kind: "tool_result_summary",
    topic: "swap_jupiter",
    title: "Swap 100 USDC na SOL przez Jupiter",
    summary:
      "Agent wykonał swap 100 USDC na SOL na Jupiter przy kursie 0.005 SOL za USDC. Slippage 0.2%, hash 4aB...Qz, potwierdzony w 3 slotach. Użytkownik dostał 0.5 SOL do portfela.",
    entities: ["USDC", "SOL", "Jupiter", "4aB...Qz"],
  },
  {
    kind: "preference",
    topic: "slippage_tolerance",
    title: "Preferencja użytkownika: maks. 0.5% slippage",
    summary:
      "User zadeklarował preferencję dla swapów z niskim slippage, tolerując maksymalnie 0.5 procenta na wszystkich trasach DEX. Dotyczy Jupiter, Orca, Raydium. Wcześniej stracił ~3% na głębokim pool'u USDC/ETH.",
    facts: { maxSlippagePct: 0.5, appliedTo: "all_dex" },
  },
  {
    kind: "decision",
    topic: "hold_eth",
    title: "Decyzja: trzymać longa ETH mimo 12% drawdownu",
    summary:
      "Podczas spadku ceny ETH o 12% user zdecydował się utrzymać long. Uzasadnienie: teza o zbliżającym się upgrade sieci i TVL na L2 bez zmian. Nie cofnął decyzji mimo dodatkowego spadku do -15% następnego dnia.",
    facts: { drawdownPct: 12, rationale: "upgrade_thesis_unchanged" },
    entities: ["ETH"],
  },
  {
    kind: "tool_result_summary",
    topic: "pnl_weekly",
    title: "Raport PnL za ostatnie 7 dni",
    summary:
      "PnL portfela za ostatnie 7 dni: +4.2% niezrealizowany (otwarte pozycje ETH, SOL, BTC) i -0.8% zrealizowany na zamkniętej pozycji short BTC otwartej @62k, zamkniętej @62500. Łączna wartość portfela wzrosła z 42500 USD do 44200 USD.",
    facts: { unrealizedPct: 4.2, realizedPct: -0.8, portfolioUsd: 44200 },
    entities: ["ETH", "SOL", "BTC"],
  },
  {
    kind: "lesson",
    topic: "gas_base_vs_mainnet",
    title: "Wnioski: Base ~4000x tańszy niż Ethereum mainnet",
    summary:
      "Porównanie kosztów gazu w czasie sesji: Base średnio 0.003 USD za swap vs Ethereum mainnet średnio 12 USD za tę samą operację. User wyciągnął wniosek, że dla swapów < 500 USD zawsze preferuje Base.",
    facts: { baseGasUsd: 0.003, mainnetGasUsd: 12, preferredChain: "Base" },
    entities: ["Base", "Ethereum"],
  },
  {
    kind: "fact",
    topic: "approve_usdc_raydium",
    title: "Approval 5000 USDC dla Raydium Router",
    summary:
      "User zatwierdził kontrakt Raydium Router do wydawania do 5000 USDC z portfela 4QpN...xyz. Ważność: permanent (unlimited). Hash zatwierdzenia 8vK...abc. Previous allowance 0, new allowance MAX_UINT256.",
    entities: ["USDC", "Raydium", "4QpN...xyz"],
  },
  {
    kind: "decision",
    topic: "stake_sol",
    title: "Decyzja: stake 2 SOL w Jito",
    summary:
      "User zdecydował się zestakować 2 SOL w Jito (jitoSOL) mimo że Marinade oferuje marginalnie wyższe APY (6.8% vs 6.7%). Uzasadnienie: Jito ma większy pool operatorów i lepszą dystrybucję ryzyka.",
    facts: { amountSol: 2, protocol: "Jito", apy: 6.7 },
    entities: ["SOL", "Jito", "Marinade"],
  },
  {
    kind: "fact",
    topic: "btc_price_check",
    title: "Cena BTC spot: 63200 USD",
    summary:
      "Agent zwrócił cenę BTC spot z Coinbase: 63200.50 USD (mid-market). 24h high 63850, 24h low 62100, volume 18500 BTC. User komentował że to 'healthy consolidation' po ostatnim ruchu.",
    facts: { priceUsd: 63200.5, volumeBtc: 18500 },
    entities: ["BTC", "Coinbase"],
  },
  // Two English episodes to simulate legacy / imported memory in the same scope.
  {
    kind: "preference",
    topic: "chain_preference_l2",
    title: "User prefers L2 chains for small swaps",
    summary:
      "User explicitly stated a preference for L2 chains (Base, Arbitrum, Optimism) for any swap under 500 USD, citing gas costs and finality speed. Mainnet Ethereum reserved for large amounts or when L2 bridge is unavailable.",
    facts: { threshold: 500, preferred: ["Base", "Arbitrum", "Optimism"] },
    entities: ["Base", "Arbitrum", "Optimism", "Ethereum"],
  },
];

// ── Demo queries ─────────────────────────────────────────────────────

interface DemoQuery {
  label: string;
  language: "pl" | "en" | "mixed";
  text: string;
  /** Expected best-hit topic — for operator sanity-check. */
  expectedTopic: string;
}

const QUERIES: readonly DemoQuery[] = [
  {
    label: "Q1 — PL slippage preference",
    language: "pl",
    text: "jakie mam ustawione slippage na DEX-ach",
    expectedTopic: "slippage_tolerance",
  },
  {
    label: "Q2 — PL balance check history",
    language: "pl",
    text: "ile miałem USDC na Solanie ostatnio",
    expectedTopic: "balance_solana",
  },
  {
    label: "Q3 — PL ETH hold rationale",
    language: "pl",
    text: "dlaczego trzymałem ETH mimo spadku",
    expectedTopic: "hold_eth",
  },
  {
    label: "Q4 — EN gas costs (should match PL lesson)",
    language: "en",
    text: "what are gas fees for Layer 2 trading",
    expectedTopic: "gas_base_vs_mainnet",
  },
  {
    label: "Q5 — mixed: PL query for EN-stored legacy episode",
    language: "mixed",
    text: "czy preferuję L2 dla małych swapów",
    expectedTopic: "chain_preference_l2",
  },
  {
    label: "Q6 — PL staking decision",
    language: "pl",
    text: "gdzie stakowałem SOL",
    expectedTopic: "stake_sol",
  },
];

// ── Main ─────────────────────────────────────────────────────────────

async function runDemo(): Promise<void> {
  const config = loadEmbeddingConfig();
  await runMigrations();

  const sessionId = `demo-recall-${Date.now()}`;
  const scopeKey = sessionId;

  logger.info("demo.start", {
    sessionId,
    scopeKey,
    episodes: EPISODES.length,
    queries: QUERIES.length,
    model: config.model,
    dim: config.dim,
  });

  await createSession(sessionId);
  await setMemoryScopeKey(sessionId, scopeKey);

  // ── Insert phase ────────────────────────────────────────────────
  const rows: NewEpisode[] = [];
  for (let i = 0; i < EPISODES.length; i++) {
    const ep = EPISODES[i]!;
    const { embedding, providerModel } = await embedDocument(ep.title, ep.summary, config);
    rows.push({
      sessionId,
      memoryScopeKey: scopeKey,
      episodeKind: ep.kind,
      summaryEn: ep.summary,
      facts: ep.facts ?? {},
      decisions: {},
      openLoops: {},
      entities: ep.entities ?? [],
      toolOutcomes: {},
      sourceSurface: "echo_agent",
      sourceSession: sessionId,
      sourceStartMessageId: i * 2 + 1,
      sourceEndMessageId: i * 2 + 2,
      episodeHash: computeEpisodeHash(ep.kind, ep.summary.trim()),
      embeddingModel: providerModel,
      embeddingDim: embedding.length,
      embedding,
    });
    logger.info("demo.embedded", {
      index: i + 1,
      kind: ep.kind,
      topic: ep.topic,
      summaryChars: ep.summary.length,
    });
  }
  const inserted = await insertEpisodes(rows);
  logger.info("demo.inserted", { count: inserted.length });

  // ── Recall phase ────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log(`Session id: ${sessionId}`);
  console.log(`Model:      ${config.model}`);
  console.log(`Scope key:  ${scopeKey}`);
  console.log(`Episodes inserted: ${inserted.length}`);
  console.log("=".repeat(70));

  for (const q of QUERIES) {
    const { embedding, providerModel } = await embedQuery(q.text, config);
    const hits = await recallTopK(embedding, {
      memoryScopeKey: scopeKey,
      embeddingModel: providerModel,
      embeddingDim: embedding.length,
      topK: 3,
      minSimilarity: 0,
    });

    console.log("\n" + "-".repeat(70));
    console.log(`${q.label}  [${q.language}]`);
    console.log(`Query: "${q.text}"`);
    console.log(`Expected best-hit topic: ${q.expectedTopic}`);
    console.log("");
    if (hits.length === 0) {
      console.log("  (no hits)");
      continue;
    }
    hits.forEach((h, idx) => {
      const topic = EPISODES.find(e => e.summary === h.episode.summaryEn)?.topic ?? "?";
      const correct = topic === q.expectedTopic ? " ✓" : "  ";
      console.log(
        `  #${idx + 1}${correct} similarity=${h.similarity.toFixed(3)}  kind=${h.episode.episodeKind.padEnd(20)}  topic=${topic}`,
      );
      const truncated = h.episode.summaryEn.length > 110
        ? h.episode.summaryEn.slice(0, 107) + "..."
        : h.episode.summaryEn;
      console.log(`       ${truncated}`);
    });
  }

  console.log("\n" + "=".repeat(70));
  console.log("Inspect in DB:");
  console.log(`  psql $ECHO_AGENT_DB_URL -c "SELECT id, episode_kind, summary_en FROM session_episodes WHERE session_id = '${sessionId}' ORDER BY id;"`);
  console.log("Drop the demo session (CASCADE removes episodes):");
  console.log(`  psql $ECHO_AGENT_DB_URL -c "DELETE FROM sessions WHERE id = '${sessionId}';"`);
  console.log("=".repeat(70));
}

// ── CLI entry ────────────────────────────────────────────────────────

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  runDemo()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async err => {
      logger.error("demo.failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await closePool().catch(() => { /* already dead */ });
      process.exit(1);
    });
}
