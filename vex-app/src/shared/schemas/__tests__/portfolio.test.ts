import { describe, expect, it } from "vitest";
import {
  portfolioDtoSchema,
  portfolioReadInputSchema,
  positionTokenDtoSchema,
} from "../portfolio.js";

const SESSION = "00000000-0000-4000-8000-000000000003";
const ISO = "2026-05-21T10:00:00.000Z";

describe("portfolio input schema", () => {
  it("accepts a global scope with no sessionId", () => {
    expect(portfolioReadInputSchema.safeParse({ scope: "global" }).success).toBe(
      true,
    );
  });

  it("rejects a stray sessionId on a global request (strict, never widens)", () => {
    expect(
      portfolioReadInputSchema.safeParse({ scope: "global", sessionId: SESSION })
        .success,
    ).toBe(false);
  });

  it("requires a sessionId on a session request", () => {
    expect(portfolioReadInputSchema.safeParse({ scope: "session" }).success).toBe(
      false,
    );
  });

  it("rejects a non-uuid sessionId on a session request", () => {
    expect(
      portfolioReadInputSchema.safeParse({ scope: "session", sessionId: "nope" })
        .success,
    ).toBe(false);
  });

  it("accepts a session request with a valid uuid sessionId", () => {
    const parsed = portfolioReadInputSchema.safeParse({
      scope: "session",
      sessionId: SESSION,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.scope === "session") {
      expect(parsed.data.sessionId).toBe(SESSION);
    }
  });

  it("rejects an unknown scope", () => {
    expect(portfolioReadInputSchema.safeParse({ scope: "all" }).success).toBe(
      false,
    );
  });
});

describe("portfolio dto schema", () => {
  function dtoFixture(overrides: Record<string, unknown> = {}) {
    return {
      scope: "global",
      walletCount: 2,
      liveTotalUsd: 1234.56,
      snapshotTotalUsd: 1200,
      pnlVsPrev: 34.56,
      snapshotAt: ISO,
      tokens: [
        { chainId: 1, symbol: "ETH", balanceUsd: 1000 },
        { chainId: 137, symbol: "USDC", balanceUsd: 234.56 },
      ],
      ...overrides,
    };
  }

  it("parses a sample dto", () => {
    expect(portfolioDtoSchema.safeParse(dtoFixture()).success).toBe(true);
  });

  it("accepts the empty portfolio (zero wallets, no snapshot)", () => {
    const parsed = portfolioDtoSchema.safeParse({
      scope: "session",
      walletCount: 0,
      liveTotalUsd: 0,
      snapshotTotalUsd: null,
      pnlVsPrev: null,
      snapshotAt: null,
      tokens: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown key (strict)", () => {
    expect(
      portfolioDtoSchema.safeParse(dtoFixture({ extraKey: true })).success,
    ).toBe(false);
  });

  it("rejects an invalid scope enum", () => {
    expect(
      portfolioDtoSchema.safeParse(dtoFixture({ scope: "everything" })).success,
    ).toBe(false);
  });

  it("rejects a negative walletCount", () => {
    expect(
      portfolioDtoSchema.safeParse(dtoFixture({ walletCount: -1 })).success,
    ).toBe(false);
  });

  it("allows a null chainId and null symbol on a token line", () => {
    expect(
      positionTokenDtoSchema.safeParse({
        chainId: null,
        symbol: null,
        balanceUsd: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown key on a token line (strict)", () => {
    expect(
      positionTokenDtoSchema.safeParse({
        chainId: 1,
        symbol: "ETH",
        balanceUsd: 1,
        raw: "0xdeadbeef",
      }).success,
    ).toBe(false);
  });

  it("rejects more than 500 token lines (defensive bound)", () => {
    const tokens = Array.from({ length: 501 }, () => ({
      chainId: 1,
      symbol: "ETH",
      balanceUsd: 1,
    }));
    expect(portfolioDtoSchema.safeParse(dtoFixture({ tokens })).success).toBe(
      false,
    );
  });
});
