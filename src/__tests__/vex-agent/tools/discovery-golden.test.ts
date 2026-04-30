/**
 * Discovery golden harness — measures top-3 retrieval quality on realistic
 * English capability-phrase intents. PR1 baseline (18); PR4 extends to 32.
 *
 * Fixtures stay English-only; discover_tools is evaluated on English
 * capability phrases.
 *
 * NOTE: Fixtures whose `expectedAny` targets a 0G-ecosystem (jaine, slop,
 * slop-app, chainscan) or EchoBook tool are marked `disabled: true` because
 * those namespaces are currently unadvertised in discovery. Re-enable when
 * the corresponding `advertised` flags flip back to `true` in
 * src/vex-agent/tools/protocols/navigation/entries-0g.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { discoverProtocolCapabilities } from "../../../vex-agent/tools/protocols/runtime.js";

interface GoldenFixture {
  intent: string;
  expectedAny: readonly string[];
  k?: number;
  notes?: string;
  /** Skip while target namespace is unadvertised in discovery. */
  disabled?: boolean;
}

const FIXTURES: readonly GoldenFixture[] = [
  // ── namespace-specific ────────────────────────────────────────────
  { intent: "bridge usdc to base", expectedAny: ["khalani.bridge", "khalani.quote"] },
  { intent: "cross chain token search", expectedAny: ["khalani.tokens"] },
  { intent: "supported bridge chains", expectedAny: ["khalani.chains"] },
  { intent: "swap on base", expectedAny: ["kyberswap.swap"] },
  { intent: "limit order on ethereum", expectedAny: ["kyberswap.limitOrder"] },
  { intent: "honeypot token check", expectedAny: ["kyberswap.tokens"] },
  { intent: "swap on solana", expectedAny: ["solana.swap"] },
  { intent: "solana token search", expectedAny: ["solana.tokens"] },
  { intent: "jupiter price lookup", expectedAny: ["solana.prices"] },
  { intent: "polymarket orderbook", expectedAny: ["polymarket.clob.orderbook", "polymarket.clob.orderbooks"] },
  { intent: "polymarket positions", expectedAny: ["polymarket.data.positions", "polymarket.data.closedPositions"] },
  { intent: "polymarket rewards earnings", expectedAny: ["polymarket.rewards"] },
  { intent: "buy yes on polymarket", expectedAny: ["polymarket.clob.buy", "polymarket.clob"] },
  { intent: "trending meme tokens", expectedAny: ["dexscreener.trending", "dexscreener.boosts"] },
  { intent: "community takeover", expectedAny: ["dexscreener.communityTakeovers"] },
  { intent: "pair liquidity analytics", expectedAny: ["dexscreener.pairs", "dexscreener.tokens"] },
  { intent: "0g chain explorer", expectedAny: ["chainscan."], disabled: true },
  { intent: "0g block height", expectedAny: ["chainscan.block", "chainscan."], disabled: true },
  { intent: "0g account balance", expectedAny: ["chainscan.account"], disabled: true },
  { intent: "echobook comments thread", expectedAny: ["echobook.comments"], disabled: true },
  { intent: "0g social feed", expectedAny: ["echobook.feed", "echobook."], disabled: true },
  { intent: "my slop tokens", expectedAny: ["slop.tokens.mine"], disabled: true },
  { intent: "slop profile image", expectedAny: ["slop-app."], disabled: true },
  { intent: "0g dex swap quote", expectedAny: ["jaine.swap"], disabled: true },
  { intent: "wrap w0g", expectedAny: ["jaine.w0g"], disabled: true },

  // ── ambiguous / cross-namespace ───────────────────────────────────
  { intent: "wallet token balances", expectedAny: ["khalani.tokens", "solana.tokens", "polymarket.data"] },
  { intent: "prediction market events", expectedAny: ["polymarket.gamma.events", "solana.predict.events"] },
  { intent: "token search", expectedAny: ["khalani.tokens", "solana.tokens", "kyberswap.tokens", "dexscreener.search", "dexscreener.tokens"] },

  // ── param-driven ──────────────────────────────────────────────────
  { intent: "slippage tolerance swap quote", expectedAny: ["kyberswap.swap", "solana.swap"] },
  { intent: "amount in chain id", expectedAny: ["khalani.quote", "kyberswap.swap"] },
  // Generic token-info query: many tools legitimately match (token resolvers,
  // bridges that take token addresses, swap tools that route by address). Accept
  // broad namespace prefixes — the goal is "some token-handling tool ranks".
  { intent: "token address contract info", expectedAny: ["chainscan.", "dexscreener.", "khalani.", "solana.tokens", "kyberswap."] },

  // ── rare-chain lexical recall (validates structured `chains` field) ─
  { intent: "swap on plasma", expectedAny: ["kyberswap.swap"] },
  { intent: "bridge to monad", expectedAny: ["khalani.bridge", "khalani.quote"] },
  // Berachain is a rare chain — only some manifests list it. Query "lp on berachain"
  // is short and ambiguous; the chain-field hit is the validation goal here, so accept
  // either kyberswap.zap (LP intent) or kyberswap.swap (kyberswap-on-berachain) as a
  // valid top-K — both show the chains lexical field is working for rare chains.
  { intent: "lp on berachain", expectedAny: ["kyberswap.zap", "kyberswap.swap"] },
];

describe("discovery golden harness", () => {
  const ENV_KEYS = [
    "JUPITER_API_KEY",
    "POLYMARKET_API_KEY",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIM",
    "EMBEDDING_PROVIDER",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    process.env.JUPITER_API_KEY = "test-jupiter-key";
    process.env.POLYMARKET_API_KEY = "test-polymarket-key";
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIM;
    delete process.env.EMBEDDING_PROVIDER;
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  for (const fixture of FIXTURES) {
    const k = fixture.k ?? 3;
    const itFn = fixture.disabled ? it.skip : it;
    itFn(`top-${k} for "${fixture.intent}" contains expected`, async () => {
      const result = await discoverProtocolCapabilities({
        query: fixture.intent,
        limit: k,
      });
      const topIds = result.tools.map((t) => t.toolId);
      const hit = fixture.expectedAny.some((expected) =>
        topIds.some((id) => id === expected || id.startsWith(`${expected}.`) || id.startsWith(expected)),
      );
      expect(hit, `topIds=${JSON.stringify(topIds)}`).toBe(true);
    });
  }

  // ── Rare-chain recall via structured `chains` field ───────────────
  // After the agent-style refactor, chain enumerations live in the
  // structured `discovery.chains` field (not interpolated into
  // `embeddingText` anymore). The lexical scorer reads them via
  // `buildMetadataFields` at weight 3. These tests assert chain matches
  // ARE driven by the `chains` field — not coincidentally by intent
  // words — by checking `whyMatched.includes("chains")`.

  it.each([
    { intent: "swap on plasma", expectedToolPrefix: "kyberswap.swap", chain: "plasma" },
    { intent: "bridge to monad", expectedToolPrefix: "khalani.bridge", chain: "monad" },
    { intent: "lp on berachain", expectedToolPrefix: "kyberswap.zap", chain: "berachain" },
  ])("rare-chain '$chain' — top-5 contains $expectedToolPrefix tagged whyMatched: 'chains'",
    async ({ intent, expectedToolPrefix }) => {
      const result = await discoverProtocolCapabilities({ query: intent, limit: 5 });
      const expected = result.tools.find((t) => t.toolId.startsWith(expectedToolPrefix));
      expect(
        expected,
        `expected toolId starting with '${expectedToolPrefix}' in top-5 for '${intent}'; got ${JSON.stringify(result.tools.map((t) => t.toolId))}`,
      ).toBeDefined();
      expect(
        expected!.whyMatched,
        `'${intent}' matched ${expected!.toolId} but NOT via the structured chains field — whyMatched=${JSON.stringify(expected!.whyMatched)}`,
      ).toContain("chains");
    },
  );

  it("baseline summary: top-3 recall across all fixtures", async () => {
    // Recall is computed only over enabled fixtures so the threshold remains
    // meaningful while disabled-namespace fixtures are skipped above.
    const activeFixtures = FIXTURES.filter((f) => !f.disabled);
    let hits = 0;
    const misses: string[] = [];
    for (const fixture of activeFixtures) {
      const k = fixture.k ?? 3;
      const result = await discoverProtocolCapabilities({
        query: fixture.intent,
        limit: k,
      });
      const topIds = result.tools.map((t) => t.toolId);
      const hit = fixture.expectedAny.some((expected) =>
        topIds.some((id) => id === expected || id.startsWith(`${expected}.`) || id.startsWith(expected)),
      );
      if (hit) hits += 1;
      else misses.push(`${fixture.intent} -> got ${JSON.stringify(topIds)}`);
    }
    const recall = hits / activeFixtures.length;
    // PR4 floor: 70% (raised from 50% after PR1-3 consistently hit 100%).
    expect(
      recall,
      `top-3 recall ${(recall * 100).toFixed(1)}% (${hits}/${activeFixtures.length}). misses:\n${misses.join("\n")}`,
    ).toBeGreaterThanOrEqual(0.7);
  });
});
