import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PREDICTION_FILES = [
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/constants.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/index.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/client.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/client/url.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/client/read.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/client/write.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/index.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/types.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/types/base.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/types/events-markets.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/types/orders-positions.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/types/profiles-tx.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/validation.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/validation/helpers.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/validation/params.ts",
  "src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/validation/body.ts",
];

describe("jupiter prediction shelf regression guards", () => {
  it("does not import legacy solana tools or undocumented routes", () => {
    for (const file of PREDICTION_FILES) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("src/tools/chains/solana");
      expect(source).not.toContain("tools/chains/solana");
      expect(source).not.toContain("lite-api.jup.ag");
      expect(source).not.toContain("/prediction/v1/orders/execute");
      expect(source).not.toContain("/follow");
      expect(source).not.toContain("/unfollow");
      expect(source).not.toContain("/followers");
      expect(source).not.toContain("/following");
    }
  });
});
