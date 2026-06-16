import type { Result } from "../../../ipc/result.js";
import type {
  PortfolioDto,
  PortfolioReadInput,
} from "../../../schemas/portfolio.js";

/**
 * Portfolio — read-only dual-scope POSITION portfolio (stage 3).
 *
 * `read` resolves a server-side wallet address allow-list (the configured
 * inventory for `{ scope: "global" }`, or the session's wallet scope for
 * `{ scope: "session", sessionId }`) and aggregates `proj_balances` +
 * `proj_portfolio_snapshots` into a renderer-safe DTO. An empty allow-list
 * resolves to the empty portfolio DTO, never an error. The renderer never
 * supplies a wallet address.
 */
export interface PortfolioBridge {
  readonly read: (input: PortfolioReadInput) => Promise<Result<PortfolioDto>>;
}
