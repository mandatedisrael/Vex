import { describe, it, expect } from "vitest";
import {
  validateSimplifiedMarketsResponse, validateRebatesResponse,
  validateCurrentRewardsResponse, validateMarketRewardsResponse,
  validateMultiMarketRewardsResponse, validateUserEarningsResponse,
  validateUserTotalEarningsResponse, validateUserRewardPercentagesResponse,
  validateUserEarningsMarketsResponse,
} from "@tools/polymarket/clob/validation/rewards.js";

const rewardsToken = { token_id: "111", outcome: "Yes", price: 0.8 };
const rewardsConfig = {
  id: 1, asset_address: "0x9c4E1703476E875070EE25b56A58B008CFb8FA78",
  start_date: "2026-01-01", end_date: "2026-02-01", rate_per_day: 0.25, total_rewards: 92,
};

describe("validateSimplifiedMarketsResponse", () => {
  const validMarket = {
    condition_id: "0xbd31dc8a20211944f6b70f31557f1001557b59905b7738480ca09bd4532f84af",
    rewards: { rates: [{ asset_address: "0x9c4E1703476E875070EE25b56A58B008CFb8FA78", rewards_daily_rate: 10 }], min_size: 100, max_spread: 3 },
    tokens: [{ token_id: "111", outcome: "Yes", price: 0.8, winner: false }],
    active: true, closed: false, archived: false, accepting_orders: true,
  };

  it("parses a valid paginated response", () => {
    const r = validateSimplifiedMarketsResponse({ limit: 100, next_cursor: "LTE=", count: 1, data: [validMarket] });
    expect(r.data).toHaveLength(1);
    expect(r.data[0].condition_id).toBe(validMarket.condition_id);
  });

  it("accepts unknown extra keys at every level but strips them from the parsed output", () => {
    const r = validateSimplifiedMarketsResponse({
      limit: 100, next_cursor: "", count: 1,
      data: [{ ...validMarket, futureField: "x", rewards: { ...validMarket.rewards, futureRewardField: 1 } }],
      futureEnvelopeField: true,
    });
    expect((r as unknown as Record<string, unknown>).futureEnvelopeField).toBeUndefined();
    expect((r.data[0] as unknown as Record<string, unknown>).futureField).toBeUndefined();
    expect((r.data[0].rewards as unknown as Record<string, unknown>).futureRewardField).toBeUndefined();
    expect(r.count).toBe(1);
    expect(r.data[0].condition_id).toBe(validMarket.condition_id);
  });

  it("rejects a non-object root", () => {
    expect(() => validateSimplifiedMarketsResponse(null)).toThrow();
    expect(() => validateSimplifiedMarketsResponse("bad")).toThrow();
  });

  it("rejects a malformed market (wrong field type)", () => {
    expect(() => validateSimplifiedMarketsResponse({
      limit: 100, next_cursor: "", count: 1,
      data: [{ ...validMarket, active: "yes" }],
    })).toThrow();
  });

  it("rejects an oversized data array", () => {
    const data = Array.from({ length: 501 }, () => validMarket);
    expect(() => validateSimplifiedMarketsResponse({ limit: 500, next_cursor: "", count: 501, data })).toThrow();
  });
});

describe("validateRebatesResponse", () => {
  const validEntry = {
    date: "2026-02-27",
    condition_id: "0xbd31dc8a20211944f6b70f31557f1001557b59905b7738480ca09bd4532f84af",
    asset_address: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
    maker_address: "0xFeA4cB3dD4ca7CefD3368653B7D6FF9BcDFca604",
    rebated_fees_usdc: "0.237519",
  };

  it("parses a valid array", () => {
    const r = validateRebatesResponse([validEntry]);
    expect(r).toHaveLength(1);
    expect(r[0].rebated_fees_usdc).toBe("0.237519");
  });

  it("accepts unknown extra keys but strips them from the parsed output", () => {
    const r = validateRebatesResponse([{ ...validEntry, futureField: 1 }]);
    expect((r[0] as unknown as Record<string, unknown>).futureField).toBeUndefined();
    expect(r).toHaveLength(1);
  });

  it("rejects a non-array root", () => {
    expect(() => validateRebatesResponse({})).toThrow();
    expect(() => validateRebatesResponse(null)).toThrow();
  });

  it("rejects an oversized array", () => {
    expect(() => validateRebatesResponse(Array.from({ length: 501 }, () => validEntry))).toThrow();
  });

  it("rejects a malformed entry", () => {
    expect(() => validateRebatesResponse([{ ...validEntry, rebated_fees_usdc: 123 }])).toThrow();
  });
});

describe("validateCurrentRewardsResponse", () => {
  const validReward = {
    condition_id: "0xbd31dc8a20211944f6b70f31557f1001557b59905b7738480ca09bd4532f84af",
    rewards_max_spread: 3, rewards_min_size: 100, rewards_config: [rewardsConfig],
  };

  it("parses a valid response, optional fields absent", () => {
    const r = validateCurrentRewardsResponse({ limit: 500, count: 1, next_cursor: "LTE=", data: [validReward] });
    expect(r.data[0].sponsored_daily_rate).toBeUndefined();
    expect(r.data[0].rewards_config[0].rate_per_day).toBe(0.25);
  });

  it("parses optional sponsor fields when present", () => {
    const r = validateCurrentRewardsResponse({
      limit: 500, count: 1, next_cursor: "",
      data: [{ ...validReward, sponsored_daily_rate: 5, sponsors_count: 2, native_daily_rate: 1, total_daily_rate: 6 }],
    });
    expect(r.data[0].sponsors_count).toBe(2);
  });

  it("rejects malformed root", () => {
    expect(() => validateCurrentRewardsResponse([])).toThrow();
  });

  it("rejects an oversized nested rewards_config array", () => {
    const oversized = { ...validReward, rewards_config: Array.from({ length: 101 }, () => rewardsConfig) };
    expect(() => validateCurrentRewardsResponse({ limit: 500, count: 1, next_cursor: "", data: [oversized] })).toThrow();
  });
});

describe("validateMarketRewardsResponse", () => {
  const validReward = {
    condition_id: "0xbd31dc8a20211944f6b70f31557f1001557b59905b7738480ca09bd4532f84af",
    question: "Will X happen?", market_slug: "will-x-happen", event_slug: "x-event", image: "https://img",
    rewards_max_spread: 3, rewards_min_size: 100, market_competitiveness: 0.5,
    tokens: [rewardsToken], rewards_config: [rewardsConfig],
  };

  it("parses a valid response", () => {
    const r = validateMarketRewardsResponse({ limit: 500, count: 1, next_cursor: "", data: [validReward] });
    expect(r.data[0].tokens[0].token_id).toBe("111");
  });

  it("accepts unknown extra keys on the market entry but strips them from the parsed output", () => {
    const r = validateMarketRewardsResponse({ limit: 500, count: 1, next_cursor: "", data: [{ ...validReward, extra: "z" }] });
    expect((r.data[0] as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(r.data).toHaveLength(1);
  });

  it("rejects a missing required field", () => {
    const { question: _question, ...withoutQuestion } = validReward;
    expect(() => validateMarketRewardsResponse({ limit: 500, count: 1, next_cursor: "", data: [withoutQuestion] })).toThrow();
  });
});

describe("validateMultiMarketRewardsResponse", () => {
  const validInfo = {
    condition_id: "0xabc", event_id: "e1", event_slug: "event-1", created_at: "2026-01-01T00:00:00Z",
    group_item_title: "Trump wins", image: "https://img", market_competitiveness: 0.9, market_id: "m1",
    market_slug: "trump-wins", one_day_price_change: 0.02, question: "Will Trump win?",
    rewards_max_spread: 3, rewards_min_size: 100, spread: 0.01, end_date: "2026-12-31",
    tokens: [rewardsToken], volume_24hr: 10000, rewards_config: [rewardsConfig],
  };

  it("parses a valid response", () => {
    const r = validateMultiMarketRewardsResponse({ limit: 100, count: 1, next_cursor: "", data: [validInfo] });
    expect(r.data[0].market_id).toBe("m1");
  });

  it("rejects an oversized data array", () => {
    const data = Array.from({ length: 501 }, () => validInfo);
    expect(() => validateMultiMarketRewardsResponse({ limit: 500, count: 501, next_cursor: "", data })).toThrow();
  });

  it("rejects a non-object root", () => {
    expect(() => validateMultiMarketRewardsResponse(undefined)).toThrow();
  });
});

describe("validateUserEarningsResponse", () => {
  const validEarning = {
    date: "2024-03-26T00:00:00Z",
    condition_id: "0xbd31dc8a20211944f6b70f31557f1001557b59905b7738480ca09bd4532f84af",
    asset_address: "0x9c4E1703476E875070EE25b56A58B008CFb8FA78",
    maker_address: "0xFeA4cB3dD4ca7CefD3368653B7D6FF9BcDFca604",
    earnings: 0.237519, asset_rate: 1,
  };

  it("parses a valid paginated response", () => {
    const r = validateUserEarningsResponse({ limit: 100, count: 1, next_cursor: "LTE=", data: [validEarning] });
    expect(r.data[0].earnings).toBe(0.237519);
  });

  it("rejects a malformed earnings field", () => {
    expect(() => validateUserEarningsResponse({
      limit: 100, count: 1, next_cursor: "", data: [{ ...validEarning, earnings: "bad" }],
    })).toThrow();
  });
});

describe("validateUserTotalEarningsResponse", () => {
  const validEntry = {
    date: "2024-04-09T00:00:00Z", asset_address: "0x9c4E1703476E875070EE25b56A58B008CFb8FA78",
    maker_address: "0xD527CCdBEB6478488c848465F9947bDA3C2e6994", earnings: 1.59984, asset_rate: 0.999357,
  };

  it("parses a valid array response", () => {
    const r = validateUserTotalEarningsResponse([validEntry]);
    expect(r).toHaveLength(1);
    expect(r[0].earnings).toBe(1.59984);
  });

  it("accepts unknown extra keys but strips them from the parsed output", () => {
    const r = validateUserTotalEarningsResponse([{ ...validEntry, extra: true }]);
    expect((r[0] as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(r).toHaveLength(1);
  });

  it("rejects a non-array root", () => {
    expect(() => validateUserTotalEarningsResponse({})).toThrow();
  });

  it("rejects an oversized array", () => {
    expect(() => validateUserTotalEarningsResponse(Array.from({ length: 501 }, () => validEntry))).toThrow();
  });
});

describe("validateUserRewardPercentagesResponse", () => {
  it("parses a valid condition_id → percentage map", () => {
    const r = validateUserRewardPercentagesResponse({
      "0x296ea2f3ad438ce7ead77f40d0159bf3e5d8be146f6f615fa253b00e02243f5c": 20,
      "0xbd31dc8a20211944f6b70f31557f1001557b59905b7738480ca09bd4532f84af": 20,
    });
    expect(r["0x296ea2f3ad438ce7ead77f40d0159bf3e5d8be146f6f615fa253b00e02243f5c"]).toBe(20);
  });

  it("rejects a non-object root", () => {
    expect(() => validateUserRewardPercentagesResponse(null)).toThrow();
    expect(() => validateUserRewardPercentagesResponse([])).toThrow();
  });

  it("rejects a non-numeric value", () => {
    expect(() => validateUserRewardPercentagesResponse({ "0xabc": "20" })).toThrow();
  });

  it("rejects an oversized map", () => {
    const oversized: Record<string, number> = {};
    for (let i = 0; i < 501; i++) oversized[`0x${i}`] = i;
    expect(() => validateUserRewardPercentagesResponse(oversized)).toThrow();
  });
});

describe("validateUserEarningsMarketsResponse", () => {
  const validMarket = {
    condition_id: "0xabc", market_id: "m1", event_id: "e1", question: "Will Trump win Iowa?",
    market_slug: "trump-iowa", event_slug: "iowa-2024", image: "https://img",
    rewards_max_spread: 3, rewards_min_size: 100, volume_24hr: 5000, spread: 0.01,
    market_competitiveness: 0.7, tokens: [rewardsToken], rewards_config: [rewardsConfig],
    maker_address: "0xFeA4cB3dD4ca7CefD3368653B7D6FF9BcDFca604", earning_percentage: 30,
    earnings: [{ asset_address: "0x9c4E1703476E875070EE25b56A58B008CFb8FA78", earnings: 12.3, asset_rate: 1.001 }],
  };

  it("parses a valid response including total_count", () => {
    const r = validateUserEarningsMarketsResponse({ limit: 100, count: 1, total_count: 1, next_cursor: "LTE=", data: [validMarket] });
    expect(r.total_count).toBe(1);
    expect(r.data[0].earnings[0].asset_rate).toBe(1.001);
  });

  it("rejects an oversized nested earnings array", () => {
    const oversized = { ...validMarket, earnings: Array.from({ length: 101 }, () => validMarket.earnings[0]) };
    expect(() => validateUserEarningsMarketsResponse({ limit: 100, count: 1, total_count: 1, next_cursor: "", data: [oversized] })).toThrow();
  });

  it("rejects a malformed root", () => {
    expect(() => validateUserEarningsMarketsResponse("bad")).toThrow();
  });
});
