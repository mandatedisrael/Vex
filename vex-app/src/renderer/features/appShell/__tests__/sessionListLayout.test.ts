import { describe, expect, it } from "vitest";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import {
  computeVisibleGroups,
  SIDEBAR_GROUP_GAP_PX,
  SIDEBAR_GROUP_HEADER_HEIGHT_PX,
  SIDEBAR_ROW_GAP_PX,
  SIDEBAR_ROW_HEIGHT_PX,
} from "../sessionListLayout.js";
import { groupSessions, type SessionGroup } from "../sessionListModel.js";

function makeRow(
  overrides: Partial<SessionListItem> = {},
): SessionListItem {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    mode: overrides.mode ?? "agent",
    permission: overrides.permission ?? "restricted",
    title: overrides.title ?? "Untitled",
    initialGoal: overrides.initialGoal ?? null,
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    endedAt: overrides.endedAt ?? null,
    missionStatus: overrides.missionStatus ?? null,
    pinnedAt: overrides.pinnedAt ?? null,
  };
}

function makeGroup(key: SessionGroup["key"], rows: SessionListItem[]): SessionGroup {
  return { key, title: key, rows };
}

function rowsForBucket(count: number, startedAt: string): SessionListItem[] {
  return Array.from({ length: count }, (_, idx) =>
    makeRow({
      id: `00000000-0000-4000-8000-${String(idx).padStart(12, "0")}`,
      startedAt,
      title: `row-${idx}`,
    }),
  );
}

describe("computeVisibleGroups", () => {
  it("pins the ledger-row height the packer budgets with", () => {
    // The 56px ledger-row redesign (h-14 in SessionRow.tsx) and the packer must move together.
    expect(SIDEBAR_ROW_HEIGHT_PX).toBe(56);
  });

  it("returns the input untouched when availableHeight <= 0 (initial render / no ResizeObserver)", () => {
    const groups: readonly SessionGroup[] = [
      makeGroup("today", rowsForBucket(5, new Date().toISOString())),
    ];
    const result = computeVisibleGroups(groups, 0);
    expect(result.visible).toBe(groups);
    expect(result.hiddenCount).toBe(0);

    const negative = computeVisibleGroups(groups, -10);
    expect(negative.visible).toBe(groups);
    expect(negative.hiddenCount).toBe(0);
  });

  it("packs whole sections when there is room and reports zero hidden", () => {
    const todayRows = rowsForBucket(3, new Date().toISOString());
    const groups = [makeGroup("today", todayRows)];

    const sectionHeight =
      SIDEBAR_GROUP_HEADER_HEIGHT_PX +
      todayRows.length * SIDEBAR_ROW_HEIGHT_PX +
      (todayRows.length - 1) * SIDEBAR_ROW_GAP_PX +
      SIDEBAR_GROUP_GAP_PX;

    const result = computeVisibleGroups(groups, sectionHeight);
    expect(result.visible).toHaveLength(1);
    expect(result.visible[0]?.rows).toHaveLength(3);
    expect(result.hiddenCount).toBe(0);
  });

  it("truncates a section that does not entirely fit, counts the rest as hidden", () => {
    const todayRows = rowsForBucket(10, new Date().toISOString());
    const groups = [makeGroup("today", todayRows)];

    // Budget: header + exactly 4 rows worth of slot space.
    const budget =
      SIDEBAR_GROUP_HEADER_HEIGHT_PX +
      4 * SIDEBAR_ROW_HEIGHT_PX +
      3 * SIDEBAR_ROW_GAP_PX;
    const result = computeVisibleGroups(groups, budget);

    expect(result.visible).toHaveLength(1);
    expect(result.visible[0]?.rows).toHaveLength(4);
    expect(result.hiddenCount).toBe(6);
  });

  it("buries an entire section when there is not even room for header + 1 row", () => {
    const todayRows = rowsForBucket(2, new Date().toISOString());
    const olderRows = rowsForBucket(3, new Date(0).toISOString());
    const groups = [
      makeGroup("today", todayRows),
      makeGroup("older", olderRows),
    ];

    // Budget: just enough for today's two rows; older cannot even get
    // its header in.
    const budget =
      SIDEBAR_GROUP_HEADER_HEIGHT_PX +
      2 * SIDEBAR_ROW_HEIGHT_PX +
      1 * SIDEBAR_ROW_GAP_PX;
    const result = computeVisibleGroups(groups, budget);

    expect(result.visible.map((g) => g.key)).toEqual(["today"]);
    expect(result.visible[0]?.rows).toHaveLength(2);
    expect(result.hiddenCount).toBe(3);
  });

  it("skips empty groups without consuming budget", () => {
    const todayRows = rowsForBucket(1, new Date().toISOString());
    const groups = [
      makeGroup("pinned", []),
      makeGroup("today", todayRows),
      makeGroup("yesterday", []),
    ];
    const sectionHeight =
      SIDEBAR_GROUP_HEADER_HEIGHT_PX + SIDEBAR_ROW_HEIGHT_PX;

    const result = computeVisibleGroups(groups, sectionHeight);
    expect(result.visible.map((g) => g.key)).toEqual(["today"]);
    expect(result.hiddenCount).toBe(0);
  });
});

describe("groupSessions (pinned bucket invariant)", () => {
  it("places pinned rows in the pinned bucket and excludes them from time buckets", () => {
    const todayIso = new Date().toISOString();
    const pinnedRow = makeRow({
      id: "aaaa1111-1111-4111-8111-111111111111",
      startedAt: todayIso,
      pinnedAt: new Date().toISOString(),
    });
    const todayRow = makeRow({
      id: "bbbb2222-2222-4222-8222-222222222222",
      startedAt: todayIso,
    });

    const groups = groupSessions([pinnedRow, todayRow]);

    const pinned = groups.find((g) => g.key === "pinned");
    const today = groups.find((g) => g.key === "today");
    expect(pinned?.rows.map((r) => r.id)).toEqual([pinnedRow.id]);
    expect(today?.rows.map((r) => r.id)).toEqual([todayRow.id]);
  });

  it("orders pinned bucket by pinnedAt DESC (most recently pinned first)", () => {
    const olderPin = makeRow({
      id: "aaaa0000-0000-4000-8000-000000000001",
      pinnedAt: "2026-05-19T10:00:00.000Z",
    });
    const newerPin = makeRow({
      id: "bbbb0000-0000-4000-8000-000000000002",
      pinnedAt: "2026-05-19T12:00:00.000Z",
    });
    const groups = groupSessions([olderPin, newerPin]);
    const pinned = groups.find((g) => g.key === "pinned");
    expect(pinned?.rows.map((r) => r.id)).toEqual([newerPin.id, olderPin.id]);
  });
});
