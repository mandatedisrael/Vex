import { describe, expect, it } from "vitest";
import { chatSubmitInputSchema } from "../chat.js";
import { sessionCreateInputSchema } from "../sessions.js";

describe("sessionCreateInputSchema", () => {
  it("accepts mission creation without an initial goal", () => {
    const parsed = sessionCreateInputSchema.safeParse({
      mode: "mission",
      name: "LP rebalance",
      permission: "restricted",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects goal text in the create-session payload", () => {
    const parsed = sessionCreateInputSchema.safeParse({
      mode: "mission",
      name: "LP rebalance",
      permission: "restricted",
      initialGoal: "Rebalance Arbitrum LP",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("chatSubmitInputSchema", () => {
  it("trims and accepts the first mission goal as chat text", () => {
    const parsed = chatSubmitInputSchema.safeParse({
      sessionId: "11111111-1111-4111-8111-111111111111",
      message: "  Rebalance Arbitrum LP  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.message).toBe("Rebalance Arbitrum LP");
    }
  });
});
