/**
 * Integration: `getAllMessages` dedupe semantics against a real Postgres.
 *
 * Mock-based tests prove the SQL string has `NOT EXISTS` against
 * `messages_archive`; only a live DB can prove the query actually does what
 * that clause is supposed to do across the giant-tool fork scenario, where
 * the same `id` exists in BOTH tables.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { archivePrefix, forkToolMessageToArchive } from "@echo-agent/db/repos/sessions.js";
import { getAllMessages } from "@echo-agent/db/repos/messages.js";
import { insertMessage, makeSession, resetDb } from "../setup/fixtures.js";

describe("getAllMessages (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns archive + live ordered by created_at,id without duplicates on normal prefix archive", async () => {
    const sid = await makeSession();
    await insertMessage(sid, "user", "m1", { timestamp: "2026-04-17T00:00:01Z" });
    await insertMessage(sid, "assistant", "m2", { timestamp: "2026-04-17T00:00:02Z" });
    const cutoff = await insertMessage(sid, "user", "m3", { timestamp: "2026-04-17T00:00:03Z" });
    await insertMessage(sid, "assistant", "m4", { timestamp: "2026-04-17T00:00:04Z" });
    await insertMessage(sid, "user", "m5", { timestamp: "2026-04-17T00:00:05Z" });

    await archivePrefix(sid, cutoff, 2);

    const result = await getAllMessages(sid);
    expect(result.map((m) => m.content)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("prefers the archive (canonical) payload over the live placeholder for a forked id", async () => {
    const sid = await makeSession();
    await insertMessage(sid, "user", "before", { timestamp: "2026-04-17T00:00:01Z" });
    const giantId = await insertMessage(sid, "tool", "CANONICAL_FULL", {
      toolCallId: "tc-big",
      timestamp: "2026-04-17T00:00:02Z",
    });
    await insertMessage(sid, "user", "after", { timestamp: "2026-04-17T00:00:03Z" });

    await forkToolMessageToArchive(giantId, "[placeholder]");

    const result = await getAllMessages(sid);
    expect(result).toHaveLength(3);
    const giantRow = result.find((m) => m.id === giantId);
    expect(giantRow?.content).toBe("CANONICAL_FULL");
    // Placeholder must NOT appear — NOT EXISTS in messages_archive filters it out.
    expect(result.some((m) => m.content === "[placeholder]")).toBe(false);
  });

  it("still returns canonical archive payload after the forked id ages into a normal prefix", async () => {
    const sid = await makeSession();
    await insertMessage(sid, "user", "pre", { timestamp: "2026-04-17T00:00:01Z" });
    const giantId = await insertMessage(sid, "tool", "CANONICAL_BIG", {
      toolCallId: "tc-big",
      timestamp: "2026-04-17T00:00:02Z",
    });
    await insertMessage(sid, "user", "tail", { timestamp: "2026-04-17T00:00:03Z" });

    await forkToolMessageToArchive(giantId, "[placeholder]");
    // Age the prefix covering the forked id. Archive already has giantId with
    // the original payload; the prefix archive INSERT must be a no-op for
    // that id (ON CONFLICT DO NOTHING). getAllMessages should still see the
    // row exactly once, with the canonical payload — plus the tail row.
    await archivePrefix(sid, giantId, 1);

    const result = await getAllMessages(sid);
    expect(result.map((m) => m.content)).toEqual(["pre", "CANONICAL_BIG", "tail"]);
    expect(result.filter((m) => m.id === giantId)).toHaveLength(1);
    expect(result.find((m) => m.id === giantId)?.content).toBe("CANONICAL_BIG");
  });
});
