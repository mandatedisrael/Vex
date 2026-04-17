/**
 * Integration: end-to-end giant-tool chain auditor flagged as untested.
 *
 * Scenario:
 *   1. Session accumulates messages, one of which is a bloated tool result.
 *   2. Checkpoint runs giant-tool fallback: forks that row into archive,
 *      replaces live content with a short placeholder.
 *   3. Episode extraction inserts a `tool_result_summary` tied to the forked
 *      id via `source_end_message_id`.
 *   4. Normal prefix archive later ages the placeholder row into archive —
 *      must NOT clobber the archived original, must NOT produce a duplicate
 *      row in history view.
 *
 * This is the scenario where the `ON CONFLICT (id) DO NOTHING` on archive
 * inserts AND the `NOT EXISTS` dedupe in `getAllMessages` collaborate. Either
 * one alone leaves a broken state; only the combination holds.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { archivePrefix, forkToolMessageToArchive } from "@echo-agent/db/repos/sessions.js";
import { getAllMessages } from "@echo-agent/db/repos/messages.js";
import { execute, query } from "@echo-agent/db/client.js";
import {
  insertEpisodes,
  listRecentBySession,
} from "@echo-agent/db/repos/session-episodes.js";
import {
  episodeHash,
  insertMessage,
  makeSession,
  randVector,
  resetDb,
} from "../setup/fixtures.js";

describe("giant-tool → fork → episode → prefix-archive chain (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("keeps one archive row per id, placeholder points at the real episode, no history duplicates", async () => {
    const sid = await makeSession(undefined, { memoryScopeKey: "scope-giant" });
    const pre = await insertMessage(sid, "user", "kick off", {
      timestamp: "2026-04-17T00:00:01Z",
    });
    const giantId = await insertMessage(sid, "tool", "ENORMOUS_TOOL_RESULT_BODY", {
      toolCallId: "tc-big",
      timestamp: "2026-04-17T00:00:02Z",
    });
    const tail = await insertMessage(sid, "user", "follow up", {
      timestamp: "2026-04-17T00:00:03Z",
    });

    // Step 1: fork — archive holds canonical payload, live holds placeholder.
    await forkToolMessageToArchive(giantId, "[placeholder: episode TBD]");

    // Step 2: extract + insert a tool_result_summary episode for the forked id.
    const summary = "Tool returned aggregated market snapshot.";
    const inserted = await insertEpisodes([
      {
        sessionId: sid,
        memoryScopeKey: "scope-giant",
        episodeKind: "tool_result_summary",
        summaryEn: summary,
        facts: {},
        decisions: {},
        openLoops: {},
        entities: [],
        toolOutcomes: { tc_big: "ok" },
        sourceSurface: "echo_agent",
        sourceSession: null,
        sourceStartMessageId: giantId,
        sourceEndMessageId: giantId,
        episodeHash: episodeHash("tool_result_summary", summary),
        embeddingModel: "test-model",
        embeddingDim: 8,
        embedding: randVector(8, "giant-episode"),
      },
    ]);
    expect(inserted).toHaveLength(1);
    const episodeId = inserted[0].id;

    // Point the placeholder at the real episode id — prod code does this
    // via `addMessage`-level update; here we use the same SQL the engine
    // would emit.
    await execute("UPDATE messages SET content = $1 WHERE id = $2", [
      `[placeholder: episode ${episodeId}]`,
      giantId,
    ]);

    // Step 3: a normal prefix archive ages everything up to the forked id
    // into archive. The archive insert for giantId MUST be a no-op — the
    // canonical payload was already copied during fork.
    await archivePrefix(sid, giantId, 1);

    const archive = await query<{ id: number; content: string }>(
      "SELECT id, content FROM messages_archive WHERE session_id = $1 ORDER BY id ASC",
      [sid],
    );
    const live = await query<{ id: number; content: string }>(
      "SELECT id, content FROM messages WHERE session_id = $1 ORDER BY id ASC",
      [sid],
    );

    // Archive has exactly 2 rows (pre + giant) — each id appears once.
    expect(archive.map((r) => r.id)).toEqual([pre, giantId]);
    expect(archive.find((r) => r.id === giantId)?.content).toBe("ENORMOUS_TOOL_RESULT_BODY");
    // Live only has the tail row.
    expect(live.map((r) => r.id)).toEqual([tail]);

    // History view: archive wins on giantId, placeholder is filtered out.
    const history = await getAllMessages(sid);
    expect(history).toHaveLength(3);
    expect(history.filter((m) => m.id === giantId)).toHaveLength(1);
    expect(history.find((m) => m.id === giantId)?.content).toBe(
      "ENORMOUS_TOOL_RESULT_BODY",
    );
    expect(history.some((m) => m.content?.startsWith("[placeholder"))).toBe(false);

    // Episode is reachable via listRecentBySession and points at the forked id.
    const episodes = await listRecentBySession(sid);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].sourceEndMessageId).toBe(giantId);
    expect(episodes[0].episodeKind).toBe("tool_result_summary");
  });

  it("replaying the whole chain on the same ids stays idempotent (no unique-index crash)", async () => {
    const sid = await makeSession(undefined, { memoryScopeKey: "scope-rerun" });
    await insertMessage(sid, "user", "pre", { timestamp: "2026-04-17T00:00:01Z" });
    const giantId = await insertMessage(sid, "tool", "BIG_ONE", {
      toolCallId: "tc-big",
      timestamp: "2026-04-17T00:00:02Z",
    });
    await insertMessage(sid, "user", "tail", { timestamp: "2026-04-17T00:00:03Z" });

    await forkToolMessageToArchive(giantId, "[ph1]");
    await archivePrefix(sid, giantId, 1);

    // Retry — each step must be a no-op on re-entry.
    await expect(forkToolMessageToArchive(giantId, "[ph2]")).resolves.toBeUndefined();
    await expect(archivePrefix(sid, giantId, 1)).resolves.toBeUndefined();

    const history = await getAllMessages(sid);
    expect(history.filter((m) => m.id === giantId)).toHaveLength(1);
    expect(history.find((m) => m.id === giantId)?.content).toBe("BIG_ONE");
  });
});
