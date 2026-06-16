import { CH } from "../../shared/ipc/channels.js";
import { portfolioReadInputSchema } from "../../shared/schemas/portfolio.js";
import type { PortfolioReadInput } from "../../shared/schemas/portfolio.js";
import type { PortfolioBridge } from "../../shared/types/bridge/agent/portfolio.js";
import { invokeWithSchema } from "../_dispatch.js";

export const portfolio = {
  read(input: PortfolioReadInput) {
    return invokeWithSchema(CH.portfolio.read, input, portfolioReadInputSchema);
  },
} satisfies PortfolioBridge;
