/**
 * Barrel-surface test for `src/tools/polymarket/data/validation.ts` after the
 * structural split into `./validation/` resource modules (positions /
 * activity-trades / market-stats / leaderboard) with shared primitives
 * single-sourced in `./validation/_shared.ts`.
 *
 * Pins the EXACT runtime export set of the barrel + each export's typeof, so a
 * caller importing from the old path (`@tools/polymarket/data/validation.js`,
 * consumed by `polymarket/data/client.ts`) sees no difference. The original
 * barrel re-exported functions only (types come from `./types.js` and were not
 * re-exported), so the runtime key set is exactly the 13 validate* functions.
 */

import { describe, expect, it } from "vitest";

type ValidationMod = typeof import("@tools/polymarket/data/validation.js");

describe("polymarket data validation barrel surface", () => {
  it("exposes exactly the 13 validate* runtime exports with correct typeof", async () => {
    const mod: ValidationMod = await import(
      "@tools/polymarket/data/validation.js"
    );

    const keys = Object.keys(mod).sort();
    expect(keys).toEqual([
      "validateActivityResponse",
      "validateBuilderLeaderboardResponse",
      "validateBuilderVolumeResponse",
      "validateClosedPositionsResponse",
      "validateHoldersResponse",
      "validateLeaderboardResponse",
      "validateLiveVolumeResponse",
      "validateMarketPositionsResponse",
      "validateOpenInterestResponse",
      "validatePositionsResponse",
      "validateTradedResponse",
      "validateTradesResponse",
      "validateValueResponse",
    ]);

    expect(typeof mod.validateActivityResponse).toBe("function");
    expect(typeof mod.validateBuilderLeaderboardResponse).toBe("function");
    expect(typeof mod.validateBuilderVolumeResponse).toBe("function");
    expect(typeof mod.validateClosedPositionsResponse).toBe("function");
    expect(typeof mod.validateHoldersResponse).toBe("function");
    expect(typeof mod.validateLeaderboardResponse).toBe("function");
    expect(typeof mod.validateLiveVolumeResponse).toBe("function");
    expect(typeof mod.validateMarketPositionsResponse).toBe("function");
    expect(typeof mod.validateOpenInterestResponse).toBe("function");
    expect(typeof mod.validatePositionsResponse).toBe("function");
    expect(typeof mod.validateTradedResponse).toBe("function");
    expect(typeof mod.validateTradesResponse).toBe("function");
    expect(typeof mod.validateValueResponse).toBe("function");
  });
});
