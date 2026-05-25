/**
 * Unit tests for the per-wallet Polymarket credential map (puzzle 5 B-core).
 *
 * Pure module — uses the REAL viem `getAddress` for normalization and the REAL
 * zod schema for parsing; no mocks. Pins the fail-closed contract: a present
 * but malformed map throws (never silently degrades to "no creds").
 */

import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { VexError, ErrorCodes } from "../../errors.js";
import {
  buildPolymarketVaultUpdates,
  normalizePolyAddress,
  parseCredentialMapEnv,
  serializeCredentialMap,
  withCredentialEntry,
  type StoredPolyCredentials,
} from "@tools/polymarket/credential-map.js";

const ADDR_A_LC = `0x${"ab".repeat(20)}`;
const ADDR_B_LC = `0x${"cd".repeat(20)}`;
const CREDS_A: StoredPolyCredentials = { apiKey: "ak-a", apiSecret: "as-a", passphrase: "pp-a" };
const CREDS_B: StoredPolyCredentials = { apiKey: "ak-b", apiSecret: "as-b", passphrase: "pp-b" };

describe("normalizePolyAddress", () => {
  it("lowercases a checksummed address", () => {
    const checksummed = getAddress(ADDR_A_LC);
    expect(normalizePolyAddress(checksummed)).toBe(ADDR_A_LC);
  });

  it("is case-insensitive (upper and lower normalize equal)", () => {
    expect(normalizePolyAddress(ADDR_A_LC.toUpperCase().replace("0X", "0x"))).toBe(
      normalizePolyAddress(ADDR_A_LC),
    );
  });

  it("throws on a non-address string (bug surfaced, not swallowed)", () => {
    expect(() => normalizePolyAddress("not-an-address")).toThrow();
  });
});

describe("parseCredentialMapEnv", () => {
  it("treats absent / empty / whitespace as an empty map", () => {
    expect(parseCredentialMapEnv(undefined)).toEqual({});
    expect(parseCredentialMapEnv("")).toEqual({});
    expect(parseCredentialMapEnv("   ")).toEqual({});
  });

  it("parses a valid map", () => {
    const raw = JSON.stringify({ [ADDR_A_LC]: CREDS_A, [ADDR_B_LC]: CREDS_B });
    expect(parseCredentialMapEnv(raw)).toEqual({ [ADDR_A_LC]: CREDS_A, [ADDR_B_LC]: CREDS_B });
  });

  it("fails CLOSED on invalid JSON (throws VexError, not silent {})", () => {
    expect(() => parseCredentialMapEnv("{not json")).toThrow(VexError);
    try {
      parseCredentialMapEnv("{not json");
    } catch (err) {
      expect((err as VexError).code).toBe(ErrorCodes.POLYMARKET_NOT_CONFIGURED);
    }
  });

  it("fails CLOSED on a structurally wrong map (missing field)", () => {
    const raw = JSON.stringify({ [ADDR_A_LC]: { apiKey: "k", apiSecret: "s" } });
    expect(() => parseCredentialMapEnv(raw)).toThrow(VexError);
  });

  it("fails CLOSED on extra fields (strict creds shape)", () => {
    const raw = JSON.stringify({ [ADDR_A_LC]: { ...CREDS_A, rogue: "x" } });
    expect(() => parseCredentialMapEnv(raw)).toThrow(VexError);
  });
});

describe("withCredentialEntry", () => {
  it("adds an entry under the normalized address key", () => {
    const next = withCredentialEntry({}, getAddress(ADDR_A_LC), CREDS_A);
    expect(next).toEqual({ [ADDR_A_LC]: CREDS_A });
  });

  it("preserves other wallets' entries (merge, never clobber)", () => {
    const next = withCredentialEntry({ [ADDR_A_LC]: CREDS_A }, ADDR_B_LC, CREDS_B);
    expect(next).toEqual({ [ADDR_A_LC]: CREDS_A, [ADDR_B_LC]: CREDS_B });
  });

  it("replaces the same wallet's entry in place", () => {
    const updated: StoredPolyCredentials = { apiKey: "new", apiSecret: "new", passphrase: "new" };
    const next = withCredentialEntry({ [ADDR_A_LC]: CREDS_A }, ADDR_A_LC, updated);
    expect(next).toEqual({ [ADDR_A_LC]: updated });
  });

  it("does not mutate the input map", () => {
    const input = { [ADDR_A_LC]: CREDS_A };
    withCredentialEntry(input, ADDR_B_LC, CREDS_B);
    expect(input).toEqual({ [ADDR_A_LC]: CREDS_A });
  });
});

describe("serializeCredentialMap", () => {
  it("round-trips through parseCredentialMapEnv", () => {
    const map = { [ADDR_A_LC]: CREDS_A, [ADDR_B_LC]: CREDS_B };
    expect(parseCredentialMapEnv(serializeCredentialMap(map))).toEqual(map);
  });
});

describe("buildPolymarketVaultUpdates (D1 — shared write rule)", () => {
  const MAP_KEY = "POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS";

  it("non-primary: writes ONLY the per-address map (no fixed keys)", () => {
    const updates = buildPolymarketVaultUpdates({
      currentMapEnv: undefined, address: ADDR_A_LC, creds: CREDS_A, isPrimary: false,
    });
    expect(Object.keys(updates)).toEqual([MAP_KEY]);
    expect(JSON.parse(updates[MAP_KEY as keyof typeof updates]!)).toEqual({ [ADDR_A_LC]: CREDS_A });
    expect(updates).not.toHaveProperty("POLYMARKET_API_KEY");
  });

  it("primary: writes the map AND the three fixed keys", () => {
    const updates = buildPolymarketVaultUpdates({
      currentMapEnv: undefined, address: ADDR_A_LC, creds: CREDS_A, isPrimary: true,
    });
    expect(JSON.parse(updates[MAP_KEY as keyof typeof updates]!)).toEqual({ [ADDR_A_LC]: CREDS_A });
    expect(updates.POLYMARKET_API_KEY).toBe(CREDS_A.apiKey);
    expect(updates.POLYMARKET_API_SECRET).toBe(CREDS_A.apiSecret);
    expect(updates.POLYMARKET_PASSPHRASE).toBe(CREDS_A.passphrase);
  });

  it("merges into an existing map (preserves other wallets)", () => {
    const current = JSON.stringify({ [ADDR_B_LC]: CREDS_B });
    const updates = buildPolymarketVaultUpdates({
      currentMapEnv: current, address: ADDR_A_LC, creds: CREDS_A, isPrimary: false,
    });
    expect(JSON.parse(updates[MAP_KEY as keyof typeof updates]!)).toEqual({
      [ADDR_B_LC]: CREDS_B,
      [ADDR_A_LC]: CREDS_A,
    });
  });

  it("fails closed on a malformed current map", () => {
    expect(() =>
      buildPolymarketVaultUpdates({
        currentMapEnv: "{bad json", address: ADDR_A_LC, creds: CREDS_A, isPrimary: false,
      }),
    ).toThrow();
  });
});
