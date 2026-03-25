import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInboxEvent } from "./_fixtures.js";

const mockPublishRepo = vi.fn();
const mockConsumePending = vi.fn();
const mockPeekPending = vi.fn();

vi.mock("../../agent/db/repos/inbox.js", () => ({
  publish: (...args: unknown[]) => mockPublishRepo(...args),
  consumePending: (...args: unknown[]) => mockConsumePending(...args),
  peekPending: (...args: unknown[]) => mockPeekPending(...args),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { publish, consumeAll, peek, formatEventsForContext } = await import(
  "../../agent/autonomy-inbox.js"
);

beforeEach(() => { vi.clearAllMocks(); });

// ── publish ─────────────────────────────────────────────────────────

describe("publish", () => {
  it("delegates to inbox repo", async () => {
    mockPublishRepo.mockResolvedValue(undefined);
    await publish("compute_balance_low", { message: "Low balance" });
    expect(mockPublishRepo).toHaveBeenCalledWith("compute_balance_low", { message: "Low balance" });
  });

  it("does not throw on repo error (fire-and-forget)", async () => {
    mockPublishRepo.mockRejectedValue(new Error("DB down"));
    await expect(publish("external_alert", {})).resolves.toBeUndefined();
  });

  it("defaults payload to empty object", async () => {
    mockPublishRepo.mockResolvedValue(undefined);
    await publish("subagent_completed");
    expect(mockPublishRepo).toHaveBeenCalledWith("subagent_completed", {});
  });
});

// ── consumeAll ──────────────────────────────────────────────────────

describe("consumeAll", () => {
  it("returns consumed events", async () => {
    const events = [mockInboxEvent(), mockInboxEvent({ id: 2 })];
    mockConsumePending.mockResolvedValue(events);
    const result = await consumeAll();
    expect(result).toHaveLength(2);
  });

  it("returns empty array on error", async () => {
    mockConsumePending.mockRejectedValue(new Error("DB error"));
    const result = await consumeAll();
    expect(result).toEqual([]);
  });

  it("returns empty array when no events", async () => {
    mockConsumePending.mockResolvedValue([]);
    const result = await consumeAll();
    expect(result).toEqual([]);
  });
});

// ── peek ────────────────────────────────────────────────────────────

describe("peek", () => {
  it("returns pending events without consuming", async () => {
    const events = [mockInboxEvent()];
    mockPeekPending.mockResolvedValue(events);
    const result = await peek();
    expect(result).toHaveLength(1);
  });

  it("returns empty array on error", async () => {
    mockPeekPending.mockRejectedValue(new Error("fail"));
    const result = await peek();
    expect(result).toEqual([]);
  });
});

// ── formatEventsForContext ───────────────────────────────────────────

describe("formatEventsForContext", () => {
  it("returns empty string for empty array", () => {
    expect(formatEventsForContext([])).toBe("");
  });

  it("formats compute_balance_low event", () => {
    const events = [mockInboxEvent({
      eventType: "compute_balance_low",
      payload: { message: "Balance is 2.5 0G" },
    })];
    const result = formatEventsForContext(events);
    expect(result).toContain("[BALANCE ALERT]");
    expect(result).toContain("Balance is 2.5 0G");
  });

  it("formats subagent_completed event", () => {
    const events = [mockInboxEvent({
      eventType: "subagent_completed",
      payload: { name: "EchoSpark", summary: "Analysis done" },
    })];
    const result = formatEventsForContext(events);
    expect(result).toContain("[SUBAGENT COMPLETED]");
    expect(result).toContain("EchoSpark");
  });

  it("formats external_alert event", () => {
    const events = [mockInboxEvent({
      eventType: "external_alert",
      payload: { message: "Price alert" },
    })];
    const result = formatEventsForContext(events);
    expect(result).toContain("[ALERT]");
    expect(result).toContain("Price alert");
  });

  it("formats unknown event type with JSON", () => {
    const events = [mockInboxEvent({
      eventType: "unknown_type" as any,
      payload: { data: 42 },
    })];
    const result = formatEventsForContext(events);
    expect(result).toContain("[EVENT]");
    expect(result).toContain("unknown_type");
  });

  it("wraps with Autonomy Events markers", () => {
    const events = [mockInboxEvent({ eventType: "external_alert", payload: { message: "test" } })];
    const result = formatEventsForContext(events);
    expect(result).toContain("--- Autonomy Events ---");
    expect(result).toContain("--- End Events ---");
  });

  it("handles multiple events with line breaks", () => {
    const events = [
      mockInboxEvent({ id: 1, eventType: "external_alert", payload: { message: "first" } }),
      mockInboxEvent({ id: 2, eventType: "external_alert", payload: { message: "second" } }),
    ];
    const result = formatEventsForContext(events);
    expect(result).toContain("first");
    expect(result).toContain("second");
  });
});
