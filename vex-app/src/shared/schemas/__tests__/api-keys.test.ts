import { describe, expect, it } from "vitest";
import {
  apiKeysSetInputSchema,
  validatePolymarketManualTrio,
} from "../api-keys.js";

describe("validatePolymarketManualTrio", () => {
  it("returns kind='empty' when all three fields are blank", () => {
    const r = validatePolymarketManualTrio({
      apiKey: "",
      apiSecret: "",
      passphrase: "",
    });
    expect(r.kind).toBe("empty");
    expect(r.missing).toEqual([]);
  });

  it("returns kind='complete' when all three fields are filled", () => {
    const r = validatePolymarketManualTrio({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(r.kind).toBe("complete");
    expect(r.missing).toEqual([]);
  });

  it("returns kind='partial' with the exact missing field names (apiKey only set)", () => {
    const r = validatePolymarketManualTrio({
      apiKey: "k",
      apiSecret: "",
      passphrase: "",
    });
    expect(r.kind).toBe("partial");
    expect(r.missing).toEqual(["apiSecret", "passphrase"]);
  });

  it("returns kind='partial' when two of three are filled", () => {
    const r = validatePolymarketManualTrio({
      apiKey: "k",
      apiSecret: "s",
      passphrase: "",
    });
    expect(r.kind).toBe("partial");
    expect(r.missing).toEqual(["passphrase"]);
  });

  it("returns kind='partial' when passphrase-only is set", () => {
    const r = validatePolymarketManualTrio({
      apiKey: "",
      apiSecret: "",
      passphrase: "p",
    });
    expect(r.kind).toBe("partial");
    expect(r.missing).toEqual(["apiKey", "apiSecret"]);
  });

  it("returns kind='partial' when apiSecret-only is set", () => {
    const r = validatePolymarketManualTrio({
      apiKey: "",
      apiSecret: "s",
      passphrase: "",
    });
    expect(r.kind).toBe("partial");
    expect(r.missing).toEqual(["apiKey", "passphrase"]);
  });

  it("returns kind='partial' when apiKey + passphrase set (apiSecret missing)", () => {
    const r = validatePolymarketManualTrio({
      apiKey: "k",
      apiSecret: "",
      passphrase: "p",
    });
    expect(r.kind).toBe("partial");
    expect(r.missing).toEqual(["apiSecret"]);
  });

  it("returns kind='partial' when apiSecret + passphrase set (apiKey missing)", () => {
    const r = validatePolymarketManualTrio({
      apiKey: "",
      apiSecret: "s",
      passphrase: "p",
    });
    expect(r.kind).toBe("partial");
    expect(r.missing).toEqual(["apiKey"]);
  });
});

describe("apiKeysSetInputSchema (boundary still demands complete trio)", () => {
  it("accepts a payload with no polymarket field at all", () => {
    const parsed = apiKeysSetInputSchema.safeParse({ jupiterApiKey: "x" });
    expect(parsed.success).toBe(true);
  });

  it("accepts a payload with a complete polymarket trio", () => {
    const parsed = apiKeysSetInputSchema.safeParse({
      polymarket: { apiKey: "k", apiSecret: "s", passphrase: "p" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a payload with a partial polymarket trio (boundary invariant)", () => {
    // The renderer helper catches this for UX, but the IPC schema is the
    // last line of defense: a partial trio must never cross the boundary.
    const parsed = apiKeysSetInputSchema.safeParse({
      polymarket: { apiKey: "k", apiSecret: "", passphrase: "p" },
    });
    expect(parsed.success).toBe(false);
  });
});
