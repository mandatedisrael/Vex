/**
 * PR-13 M-1 regression — verify the post-compact turn actually reads the
 * just-consumed handoff through `getLatestForTarget`.
 *
 * Contract: pre-PR-13 the turn read `getActive(sessionId, checkpointGen+1)`
 * which returned null after Phase II flipped the handoff to 'consumed', so
 * recall fell back to last-user-input. The fix is `getLatestForTarget(
 * checkpointGen)` accepting both active and consumed rows.
 */

import { describe, it, expect, vi } from "vitest";

import { effectiveRecallSeed } from "../../../../vex-agent/engine/core/recall-seed.js";
import type { CheckpointHandoff } from "../../../../vex-agent/db/repos/checkpoint-handoffs.js";
import { extractEpisodes } from "../../../../vex-agent/engine/checkpoint/extract.js";
import type { MessageWithId } from "../../../../vex-agent/db/repos/messages.js";
import type { InferenceProvider, InferenceConfig } from "../../../../vex-agent/inference/types.js";

function consumedHandoff(query: string): CheckpointHandoff {
  return {
    id: "h-consumed",
    sessionId: "s1",
    targetCheckpointGeneration: 5,
    status: "consumed",
    createdAt: "2026-04-20T10:00:00.000Z",
    consumedAt: "2026-04-20T10:30:00.000Z",
    payload: {
      preserveMd: "keep this",
      preferredRecallQuery: query,
      importantEntities: ["wallet-A"],
      openLoops: ["verify price feed"],
    },
  };
}

describe("PR-13 M-1 — post-compact recall reads consumed handoff", () => {
  it("effectiveRecallSeed uses the consumed handoff's preferred_recall_query", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: true,
      messages: [{ role: "user", content: "old pre-compact input", timestamp: "2026-04-20T09:00:00.000Z" }],
      activeHandoff: consumedHandoff("resume polymarket arb monitoring"),
    });
    expect(seed).toBe("resume polymarket arb monitoring");
  });

  it("getLatestForTarget SQL filters to status IN ('active','consumed') and ORDER BY created_at DESC", async () => {
    // Behavioural assertion: stub the pg pool with a query spy, call the
    // repo function, and assert the SQL it actually issues. This guards
    // against someone silently widening/narrowing the filter by editing
    // the WHERE clause.
    const queryOneMock = vi.fn().mockResolvedValue(null);
    vi.doMock("../../../../vex-agent/db/client.js", () => ({
      queryOne: queryOneMock,
      getPool: vi.fn(),
      queryOneWith: vi.fn(),
      executeWith: vi.fn(),
      execute: vi.fn(),
      query: vi.fn(),
    }));
    vi.resetModules();
    const repo = await import("../../../../vex-agent/db/repos/checkpoint-handoffs.js");

    await repo.getLatestForTarget("s1", 5);

    expect(queryOneMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryOneMock.mock.calls[0]!;
    expect(sql).toMatch(/status IN \('active', 'consumed'\)/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(sql).not.toMatch(/superseded/); // explicit exclusion invariant
    expect(params).toEqual(["s1", 5]);

    vi.doUnmock("../../../../vex-agent/db/client.js");
    vi.resetModules();
  });
});

/**
 * PR-13 S-3 regression — openLoops is threaded through.
 */
describe("PR-13 S-3 — openLoops feeds recall seed", () => {
  it("handoff.payload.openLoops becomes part of the post-wake seed", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: true,
      messages: [],
      missionObjective: "objective",
      lastEngineMessage: { messageType: "wake_due", reason: "wake cue" },
      openLoops: ["step 3 pending", "price re-check"],
    });
    expect(seed).toContain("step 3 pending");
    expect(seed).toContain("price re-check");
  });
});

/**
 * PR-13 M-2 regression — `summarizePrefix` passes preserveMd into its prompt.
 */
describe("PR-13 M-2 — preserve_md reaches summary prompt", () => {
  it("summarizePrefix injects a 'Preserve MUST block' when preserveMd is provided", async () => {
    const mockCompletion = vi.fn().mockResolvedValue({ content: "summary-out", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    const { summarizePrefix } = await import("../../../../vex-agent/engine/checkpoint/merge.js");
    await summarizePrefix(
      [{ id: 1, role: "user", content: "hello", timestamp: "2026-04-20T09:00:00.000Z" }],
      null,
      {
        id: "test", displayName: "test",
        loadConfig: vi.fn(),
        chatCompletion: vi.fn(),
        chatCompletionSimple: mockCompletion,
        chatCompletionStream: vi.fn(),
        getBalance: vi.fn(),
        calculateCost: vi.fn(),
      },
      { provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD", cachePricePerM: null, reasoningPricePerM: null },
      "en",
      "Step 3 is mid-execution: do NOT forget the 0.5% slippage cap",
    );

    const [messages] = mockCompletion.mock.calls[0]!;
    const systemPrompt = (messages as Array<{ content: string }>)[0]!.content;
    expect(systemPrompt).toContain("Preserve MUST block");
    expect(systemPrompt).toContain("slippage cap");
  });

  it("summarizePrefix omits the Preserve block entirely when preserveMd is empty", async () => {
    const mockCompletion = vi.fn().mockResolvedValue({ content: "summary", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    const { summarizePrefix } = await import("../../../../vex-agent/engine/checkpoint/merge.js");
    await summarizePrefix(
      [{ id: 1, role: "user", content: "hello", timestamp: "2026-04-20T09:00:00.000Z" }],
      null,
      {
        id: "test", displayName: "test",
        loadConfig: vi.fn(),
        chatCompletion: vi.fn(),
        chatCompletionSimple: mockCompletion,
        chatCompletionStream: vi.fn(),
        getBalance: vi.fn(),
        calculateCost: vi.fn(),
      },
      { provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD", cachePricePerM: null, reasoningPricePerM: null },
      "en",
      "",
    );

    const [messages] = mockCompletion.mock.calls[0]!;
    const systemPrompt = (messages as Array<{ content: string }>)[0]!.content;
    expect(systemPrompt).not.toContain("Preserve MUST block");
  });
});

/**
 * PR-13 S-1 regression — handoff consume is now atomic with Phase II.
 *
 * Structural assertion: the former `try { ... } catch { log.warn + proceed }`
 * block around the consume step has been removed, so any consume error
 * propagates out of `runCheckpointWriteTx` and rolls back the whole Phase II
 * tx. We verify via source-level check (no test harness can force a real
 * rollback without an integration DB).
 */
describe("PR-13 S-1 — consume atomicity with generation bump", () => {
  it("checkpoint.ts no longer silently swallows consume failures", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../../vex-agent/engine/core/checkpoint.ts", import.meta.url),
      "utf-8",
    );
    // The old warning channel must be gone.
    expect(src).not.toContain("checkpoint.handoff.consume_failed");
    // The new atomicity comment anchors the contract.
    expect(src).toMatch(/Atomicity: any error here propagates and rolls back/i);
  });
});

/**
 * PR-13 S-4 regression — overflow blob_keys land somewhere even without a
 * `tool_result_summary` episode.
 */
describe("PR-13 S-4 — overflow blob_keys fall back to the first episode", () => {
  // Helper — build a provider whose `chatCompletionSimple` returns a
  // hand-crafted episodes JSON. Only the fields touched by `extractEpisodes`
  // need real values; rest of the provider interface is stubbed.
  function makeExtractionProvider(episodes: Array<Record<string, unknown>>): InferenceProvider {
    return {
      id: "test",
      displayName: "test",
      loadConfig: vi.fn(),
      chatCompletion: vi.fn(),
      chatCompletionSimple: vi.fn().mockResolvedValue({
        content: JSON.stringify({ session_language_inferred: "en", episodes }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
      chatCompletionStream: vi.fn(),
      getBalance: vi.fn(),
      calculateCost: vi.fn(),
    } as unknown as InferenceProvider;
  }

  const config: InferenceConfig = {
    provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512,
    inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD",
    cachePricePerM: null, reasoningPricePerM: null,
  };

  // Build an overflow-carrying prefix that the real `collectOverflowBlobKeys`
  // will pick up: a tool row with `metadata.payload.overflow === true` and a
  // `blobKey` string. Parent assistant row keeps the pair-integrity simple.
  function overflowPrefix(blobKeys: string[]): MessageWithId[] {
    const prefix: MessageWithId[] = [
      {
        id: 1, role: "assistant", content: "calling tool",
        toolCalls: blobKeys.map((_, i) => ({ id: `tc-${i}`, command: "web_research", args: {} })),
        timestamp: "2026-04-20T09:00:00.000Z",
      },
    ];
    blobKeys.forEach((blobKey, i) => {
      prefix.push({
        id: 2 + i,
        role: "tool",
        content: `[tool_output_overflow blob_key=${blobKey}]`,
        toolCallId: `tc-${i}`,
        timestamp: "2026-04-20T09:00:01.000Z",
        metadata: {
          source: "tool",
          messageType: "tool_result",
          visibility: "internal",
          payload: { overflow: true, blobKey, sizeBytes: 20000, shapeKind: "text" },
        },
      });
    });
    return prefix;
  }

  it("attaches blob_keys to a tool_result_summary episode when one exists", async () => {
    const provider = makeExtractionProvider([
      { episode_kind: "tool_result_summary", title: "fetch", summary_text: "fetched a big list" },
      { episode_kind: "decision", title: "pick", summary_text: "chose option A" },
    ]);

    const result = await extractEpisodes(
      overflowPrefix(["tob-20260420-aaaaaaaaaaaaaaaa", "tob-20260420-bbbbbbbbbbbbbbbb"]),
      provider,
      config,
      "en",
    );

    expect(result.episodes).toHaveLength(2);
    const summaryEp = result.episodes.find((ep) => ep.episodeKind === "tool_result_summary")!;
    const decisionEp = result.episodes.find((ep) => ep.episodeKind === "decision")!;
    expect(summaryEp.toolOutcomes.overflow_blob_keys).toEqual([
      "tob-20260420-aaaaaaaaaaaaaaaa",
      "tob-20260420-bbbbbbbbbbbbbbbb",
    ]);
    // Non-summary episodes must NOT receive the blob_keys — prevents dupe.
    expect(decisionEp.toolOutcomes.overflow_blob_keys).toBeUndefined();
  });

  it("falls back to the first episode when no tool_result_summary exists", async () => {
    const provider = makeExtractionProvider([
      { episode_kind: "decision", title: "chose", summary_text: "picked strategy X" },
      { episode_kind: "fact", title: "price", summary_text: "SOL at 150" },
    ]);

    const result = await extractEpisodes(
      overflowPrefix(["tob-20260420-cccccccccccccccc"]),
      provider,
      config,
      "en",
    );

    expect(result.episodes).toHaveLength(2);
    expect(result.episodes[0]!.episodeKind).toBe("decision");
    expect(result.episodes[0]!.toolOutcomes.overflow_blob_keys).toEqual([
      "tob-20260420-cccccccccccccccc",
    ]);
    // The second episode must NOT receive the keys — fallback only targets
    // the first episode.
    expect(result.episodes[1]!.toolOutcomes.overflow_blob_keys).toBeUndefined();
  });

  it("drops blob_keys silently when the batch has zero episodes", async () => {
    const provider = makeExtractionProvider([]);

    const result = await extractEpisodes(
      overflowPrefix(["tob-20260420-dddddddddddddddd"]),
      provider,
      config,
      "en",
    );

    expect(result.episodes).toEqual([]);
  });

  it("is a no-op when the prefix has no overflow rows", async () => {
    const provider = makeExtractionProvider([
      { episode_kind: "tool_result_summary", title: "simple", summary_text: "no overflow here" },
    ]);

    // Pass a prefix without any metadata.payload.overflow → collector
    // returns [] so propagate is a no-op.
    const plainPrefix: MessageWithId[] = [
      {
        id: 1, role: "user", content: "hi",
        timestamp: "2026-04-20T09:00:00.000Z",
      },
    ];

    const result = await extractEpisodes(plainPrefix, provider, config, "en");

    expect(result.episodes[0]!.toolOutcomes.overflow_blob_keys).toBeUndefined();
  });
});
