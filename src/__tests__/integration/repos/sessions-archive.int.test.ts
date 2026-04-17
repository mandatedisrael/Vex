/**
 * Integration: sessions repo archive paths against a real Postgres.
 *
 * Proofs the mock-level tests can't give us:
 *   - `archivePrefix` moves rows atomically with `ON CONFLICT (id) DO NOTHING`
 *     so replaying the same cutoff (crash recovery, retry) doesn't blow up on
 *     the unique index inherited from `messages.id`'s PK.
 *   - `forkToolMessageToArchive` COPIES the live row into archive then
 *     overwrites `content` with a placeholder — future `archivePrefix` that
 *     would re-archive the forked id is a no-op (ON CONFLICT preserves the
 *     original full payload, not the placeholder).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { archivePrefix, forkToolMessageToArchive } from "@echo-agent/db/repos/sessions.js";
import { query } from "@echo-agent/db/client.js";
import { insertMessage, makeSession, resetDb } from "../setup/fixtures.js";

interface ArchiveRow {
  id: number;
  content: string;
}

async function archiveRows(sessionId: string): Promise<ArchiveRow[]> {
  return query<ArchiveRow>(
    "SELECT id, content FROM messages_archive WHERE session_id = $1 ORDER BY id ASC",
    [sessionId],
  );
}

async function liveRows(sessionId: string): Promise<ArchiveRow[]> {
  return query<ArchiveRow>(
    "SELECT id, content FROM messages WHERE session_id = $1 ORDER BY id ASC",
    [sessionId],
  );
}

describe("sessions archivePrefix (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("moves prefix into archive and leaves the tail live", async () => {
    const sid = await makeSession();
    const ids = [
      await insertMessage(sid, "user", "m1", { timestamp: "2026-04-17T00:00:01Z" }),
      await insertMessage(sid, "assistant", "m2", { timestamp: "2026-04-17T00:00:02Z" }),
      await insertMessage(sid, "user", "m3", { timestamp: "2026-04-17T00:00:03Z" }),
      await insertMessage(sid, "assistant", "m4", { timestamp: "2026-04-17T00:00:04Z" }),
      await insertMessage(sid, "user", "m5", { timestamp: "2026-04-17T00:00:05Z" }),
    ];

    await archivePrefix(sid, ids[2], 2);

    expect((await archiveRows(sid)).map((r) => r.content)).toEqual(["m1", "m2", "m3"]);
    expect((await liveRows(sid)).map((r) => r.content)).toEqual(["m4", "m5"]);
  });

  it("is idempotent — re-running the same cutoff does not collide on the unique index", async () => {
    const sid = await makeSession();
    const id1 = await insertMessage(sid, "user", "m1", { timestamp: "2026-04-17T00:00:01Z" });
    await insertMessage(sid, "assistant", "m2", { timestamp: "2026-04-17T00:00:02Z" });
    await insertMessage(sid, "user", "m3", { timestamp: "2026-04-17T00:00:03Z" });

    await archivePrefix(sid, id1, 2);
    // Second call with the same cutoff — prefix is already empty on the live
    // side, so the WITH moved / INSERT happens against an empty set. Must not
    // throw on the archive unique index.
    await expect(archivePrefix(sid, id1, 2)).resolves.toBeUndefined();

    const archived = await archiveRows(sid);
    expect(archived).toHaveLength(1);
    expect(archived[0].content).toBe("m1");
  });
});

describe("sessions forkToolMessageToArchive (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("copies original payload into archive and replaces live content with placeholder", async () => {
    const sid = await makeSession();
    const giantId = await insertMessage(sid, "tool", "HUGE_ORIGINAL_PAYLOAD", {
      toolCallId: "tc-big",
      timestamp: "2026-04-17T00:00:10Z",
    });

    await forkToolMessageToArchive(giantId, "[placeholder]");

    const archived = await archiveRows(sid);
    const live = await liveRows(sid);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toEqual({ id: giantId, content: "HUGE_ORIGINAL_PAYLOAD" });
    expect(live).toEqual([{ id: giantId, content: "[placeholder]" }]);
  });

  it("retrying fork on the same id is idempotent — original payload wins", async () => {
    const sid = await makeSession();
    const giantId = await insertMessage(sid, "tool", "ORIGINAL", {
      toolCallId: "tc-big",
      timestamp: "2026-04-17T00:00:10Z",
    });

    await forkToolMessageToArchive(giantId, "[placeholder-1]");
    // Retry: live content is now "[placeholder-1]"; a second fork must NOT
    // overwrite the archived canonical payload with the placeholder.
    await forkToolMessageToArchive(giantId, "[placeholder-2]");

    const archived = await archiveRows(sid);
    expect(archived).toHaveLength(1);
    expect(archived[0].content).toBe("ORIGINAL");
  });

  it("archivePrefix covering the forked id preserves the original archive payload (no clobber)", async () => {
    const sid = await makeSession();
    await insertMessage(sid, "user", "m1", { timestamp: "2026-04-17T00:00:01Z" });
    const giantId = await insertMessage(sid, "tool", "ORIGINAL_BIG", {
      toolCallId: "tc-big",
      timestamp: "2026-04-17T00:00:02Z",
    });
    await insertMessage(sid, "user", "m3", { timestamp: "2026-04-17T00:00:03Z" });

    await forkToolMessageToArchive(giantId, "[placeholder]");
    // Now age the whole prefix including the forked (placeholder) row into
    // archive. The archive insert for `giantId` must be a no-op — ON CONFLICT
    // DO NOTHING — so the archive still holds ORIGINAL_BIG, not the placeholder.
    await archivePrefix(sid, giantId, 1);

    const archived = await archiveRows(sid);
    const giantArchived = archived.find((r) => r.id === giantId);
    expect(giantArchived?.content).toBe("ORIGINAL_BIG");
  });
});
