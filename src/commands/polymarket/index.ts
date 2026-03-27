import { Command } from "commander";
import { createSetupSubcommand } from "./setup.js";
import { createEventsSubcommand, createEventSubcommand, createSearchSubcommand } from "./events.js";
import { createMarketSubcommand, createOrderbookSubcommand, createHistorySubcommand } from "./market.js";
import { createBuySubcommand, createSellSubcommand } from "./trade.js";
import { createPositionsSubcommand, createOrdersSubcommand, createProfileSubcommand } from "./positions.js";
import { createCancelSubcommand, createCancelAllSubcommand, createCancelMarketSubcommand } from "./cancel.js";
import { createLeaderboardSubcommand, createActivitySubcommand } from "./leaderboard.js";
import { createStreamMarketSubcommand, createStreamUserSubcommand } from "./stream.js";

export function createPolymarketCommand(): Command {
  const polymarket = new Command("polymarket")
    .description("Polymarket prediction markets — browse, trade, track (Polygon EVM)")
    .exitOverride();

  polymarket.addCommand(createSetupSubcommand());
  polymarket.addCommand(createEventsSubcommand());
  polymarket.addCommand(createEventSubcommand());
  polymarket.addCommand(createSearchSubcommand());
  polymarket.addCommand(createMarketSubcommand());
  polymarket.addCommand(createOrderbookSubcommand());
  polymarket.addCommand(createHistorySubcommand());
  polymarket.addCommand(createBuySubcommand());
  polymarket.addCommand(createSellSubcommand());
  polymarket.addCommand(createPositionsSubcommand());
  polymarket.addCommand(createOrdersSubcommand());
  polymarket.addCommand(createProfileSubcommand());
  polymarket.addCommand(createCancelSubcommand());
  polymarket.addCommand(createCancelAllSubcommand());
  polymarket.addCommand(createCancelMarketSubcommand());
  polymarket.addCommand(createLeaderboardSubcommand());
  polymarket.addCommand(createActivitySubcommand());
  polymarket.addCommand(createStreamMarketSubcommand());
  polymarket.addCommand(createStreamUserSubcommand());

  return polymarket;
}
