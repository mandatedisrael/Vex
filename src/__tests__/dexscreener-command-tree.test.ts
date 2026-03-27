import { describe, expect, it } from "vitest";
import { createDexScreenerCommand } from "../commands/dexscreener/index.js";

describe("dexscreener command tree", () => {
  it("registers all 11 expected subcommands", () => {
    const root = createDexScreenerCommand();
    const commandNames = root.commands.map((cmd) => cmd.name());
    expect(commandNames).toEqual(
      expect.arrayContaining([
        "search",
        "pairs",
        "token",
        "token-pairs",
        "profiles",
        "boosts",
        "cto",
        "ads",
        "orders",
        "trending",
        "stream",
      ]),
    );
  });

  it("has correct top-level name and description", () => {
    const root = createDexScreenerCommand();
    expect(root.name()).toBe("dexscreener");
    expect(root.description()).toContain("DEX analytics");
  });

  it("search requires a query argument", () => {
    const root = createDexScreenerCommand();
    const search = root.commands.find((cmd) => cmd.name() === "search");
    expect(search).toBeDefined();
    expect(search!.registeredArguments).toHaveLength(1);
    expect(search!.registeredArguments[0].name()).toBe("query");
    expect(search!.registeredArguments[0].required).toBe(true);
  });

  it("pairs requires chainId and pairId arguments", () => {
    const root = createDexScreenerCommand();
    const pairs = root.commands.find((cmd) => cmd.name() === "pairs");
    expect(pairs).toBeDefined();
    expect(pairs!.registeredArguments).toHaveLength(2);
  });

  it("boosts has --top option", () => {
    const root = createDexScreenerCommand();
    const boosts = root.commands.find((cmd) => cmd.name() === "boosts");
    expect(boosts).toBeDefined();
    const optionNames = boosts!.options.map((opt) => opt.long);
    expect(optionNames).toContain("--top");
  });

  it("trending has --limit option", () => {
    const root = createDexScreenerCommand();
    const trending = root.commands.find((cmd) => cmd.name() === "trending");
    expect(trending).toBeDefined();
    const optionNames = trending!.options.map((opt) => opt.long);
    expect(optionNames).toContain("--limit");
  });

  it("stream requires a type argument", () => {
    const root = createDexScreenerCommand();
    const stream = root.commands.find((cmd) => cmd.name() === "stream");
    expect(stream).toBeDefined();
    expect(stream!.registeredArguments).toHaveLength(1);
    expect(stream!.registeredArguments[0].name()).toBe("type");
  });
});
