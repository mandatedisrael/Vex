/**
 * Phase 8 (puzzle 04) archive column-list parity invariant.
 *
 * `messages.ts` exports two const tuples that drive every archive /
 * unarchive SQL projection:
 *
 *   - `MESSAGE_DB_COLUMNS`        — `messages` row columns
 *   - `MESSAGE_ARCHIVE_DB_COLUMNS` — `messages_archive` row columns
 *                                    (= `MESSAGE_DB_COLUMNS` + `rewind_checkpoint_id`)
 *
 * Mig 023 added `messages_archive.rewind_checkpoint_id` so a restore
 * path can look up the checkpoint that captured each archived row.
 * Migrating either schema without touching this tuple would silently
 * drop a column into NULL (or shift positions in an `INSERT … VALUES`
 * projection that uses a different column count) on the archive /
 * unarchive critical path — that's exactly the class of bug Codex
 * called out as residual risk after phase 5.
 *
 * This suite is the source-of-truth pin. If you ALTER either table,
 * update the corresponding tuple and the assertions below in the same
 * commit.
 */

import { describe, expect, it } from "vitest";

import {
  MESSAGE_ARCHIVE_DB_COLUMNS,
  MESSAGE_DB_COLUMNS,
} from "../../../../vex-agent/db/repos/messages.js";

const REWIND_CHECKPOINT_ID = "rewind_checkpoint_id";

describe("messages column-list parity for archive and restore", () => {
  it("MESSAGE_DB_COLUMNS is non-empty", () => {
    expect(MESSAGE_DB_COLUMNS.length).toBeGreaterThan(0);
  });

  it("MESSAGE_DB_COLUMNS has no duplicate entries", () => {
    const set = new Set(MESSAGE_DB_COLUMNS);
    expect(set.size).toBe(MESSAGE_DB_COLUMNS.length);
  });

  it("MESSAGE_DB_COLUMNS pins the canonical schema (mig 023 surface)", () => {
    // Snapshot to lock the surface — adding a column to `messages`
    // requires touching this list AND the corresponding sessions-
    // archive INSERT path. Failing this test on a deliberate schema
    // change is intentional: update the tuple in the same commit.
    expect([...MESSAGE_DB_COLUMNS]).toEqual([
      "id",
      "session_id",
      "role",
      "content",
      "tool_call_id",
      "tool_calls",
      "created_at",
      "source",
      "message_type",
      "visibility",
      "origin_session_id",
      "metadata",
    ]);
  });

  it("MESSAGE_ARCHIVE_DB_COLUMNS is exactly MESSAGE_DB_COLUMNS + rewind_checkpoint_id", () => {
    // Single-source-of-truth invariant: the archive list is the live
    // list with one extra column at the end. Mig 023 added that
    // column; nothing else may diverge between the two tables, or the
    // archive / unarchive SQL projection would line up wrong.
    expect([...MESSAGE_ARCHIVE_DB_COLUMNS]).toEqual([
      ...MESSAGE_DB_COLUMNS,
      REWIND_CHECKPOINT_ID,
    ]);
  });

  it("MESSAGE_ARCHIVE_DB_COLUMNS contains every MESSAGE_DB_COLUMNS entry in the same order", () => {
    // Position-sensitive check — `INSERT INTO messages_archive
    // (col,...) SELECT col,... FROM messages` relies on the prefix
    // being position-identical. Reordering the live tuple without
    // reordering the archive tuple would scramble rows on archive.
    for (let i = 0; i < MESSAGE_DB_COLUMNS.length; i += 1) {
      expect(MESSAGE_ARCHIVE_DB_COLUMNS[i]).toBe(MESSAGE_DB_COLUMNS[i]);
    }
  });

  it("MESSAGE_ARCHIVE_DB_COLUMNS has no duplicate entries", () => {
    const set = new Set(MESSAGE_ARCHIVE_DB_COLUMNS);
    expect(set.size).toBe(MESSAGE_ARCHIVE_DB_COLUMNS.length);
  });

  it("MESSAGE_ARCHIVE_DB_COLUMNS adds exactly one column beyond the live list", () => {
    // Defensive against accidental drift — if an archive-only column
    // is added later, this assertion has to be updated explicitly so
    // both this file AND the archive/unarchive SQL writers stay in
    // lockstep with the schema.
    expect(MESSAGE_ARCHIVE_DB_COLUMNS.length).toBe(
      MESSAGE_DB_COLUMNS.length + 1,
    );
  });

  it("rewind_checkpoint_id is NOT present in MESSAGE_DB_COLUMNS (archive-only column)", () => {
    // Mig 023's restore lookup column belongs only to the archive
    // table. If it ever leaks into the live tuple, the archive INSERT
    // path will try to copy from a column the live table doesn't have.
    expect(MESSAGE_DB_COLUMNS).not.toContain(REWIND_CHECKPOINT_ID);
  });

  it("every MESSAGE_DB_COLUMNS entry is a non-empty snake_case identifier", () => {
    // Cheap shape check — guards against fat-finger drift (e.g.
    // `"role,"` from a copy-paste mishap). Postgres would reject these
    // at query time but the test fails earlier with a clearer message.
    const SNAKE = /^[a-z][a-z0-9_]*$/;
    for (const col of MESSAGE_DB_COLUMNS) {
      expect(col).toMatch(SNAKE);
    }
  });
});
