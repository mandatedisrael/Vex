import { describe, expect, it } from "vitest";

const { TradeShareModal } = await import("../agent/ui/src/components/TradeShareModal.js");

describe("TradeShareModal", () => {
  it("exports the share modal component", () => {
    expect(TradeShareModal).toBeTypeOf("function");
  });
});
