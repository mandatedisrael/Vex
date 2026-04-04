/**
 * Polymarket Data API types — positions, activity, leaderboard, trades.
 * Base URL: https://data-api.polymarket.com
 */

export interface DataPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string | null;
  slug: string | null;
  eventSlug: string | null;
  outcome: string | null;
  outcomeIndex: number;
  endDate: string | null;
  negativeRisk: boolean;
}

export interface DataClosedPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  timestamp: number;
  title: string | null;
  slug: string | null;
  eventSlug: string | null;
  outcome: string | null;
  outcomeIndex: number;
  endDate: string | null;
}

export interface DataActivity {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: "TRADE" | "SPLIT" | "MERGE" | "REDEEM" | "REWARD" | "CONVERSION" | "MAKER_REBATE" | "REFERRAL_REWARD";
  size: number;
  usdcSize: number;
  price: number;
  asset: string;
  side: "BUY" | "SELL" | null;
  outcomeIndex: number;
  title: string | null;
  slug: string | null;
  outcome: string | null;
  transactionHash: string | null;
}

export interface DataTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string | null;
  slug: string | null;
  outcome: string | null;
  outcomeIndex: number;
  transactionHash: string | null;
  name: string | null;
  pseudonym: string | null;
  profileImage: string | null;
}

export interface DataHolder {
  proxyWallet: string;
  bio: string | null;
  asset: string;
  pseudonym: string | null;
  amount: number;
  displayUsernamePublic: boolean;
  outcomeIndex: number;
  name: string | null;
  profileImage: string | null;
}

export interface DataMetaHolder {
  token: string;
  holders: DataHolder[];
}

export interface DataOpenInterest {
  market: string;
  value: number;
}

export interface DataLiveVolume {
  total: number;
  markets: Array<{ market: string; value: number }>;
}

export interface DataLeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string | null;
  vol: number;
  pnl: number;
  profileImage: string | null;
  xUsername: string | null;
  verifiedBadge: boolean;
}

export interface DataBuilderEntry {
  rank: string;
  builder: string;
  volume: number;
  activeUsers: number;
  verified: boolean;
  builderLogo: string | null;
}

export interface DataBuilderVolumeEntry {
  dt: string;
  builder: string;
  builderLogo: string | null;
  verified: boolean;
  volume: number;
  activeUsers: number;
  rank: string;
}

export interface DataMarketPositionV1 {
  proxyWallet: string;
  name: string | null;
  profileImage: string | null;
  verified: boolean;
  asset: string;
  conditionId: string;
  avgPrice: number;
  size: number;
  currPrice: number;
  currentValue: number;
  cashPnl: number;
  totalBought: number;
  realizedPnl: number;
  totalPnl: number;
  outcome: string | null;
  outcomeIndex: number;
}

export interface DataMetaMarketPosition {
  token: string;
  positions: DataMarketPositionV1[];
}

/** Query params for getClosedPositions. Full parity with Data API. */
export interface ClosedPositionsParams {
  user: string;
  market?: string;
  eventId?: number;
  title?: string;
  limit?: number;
  offset?: number;
  sortBy?: "REALIZEDPNL" | "TITLE" | "PRICE" | "AVGPRICE" | "TIMESTAMP";
  sortDirection?: "ASC" | "DESC";
}

/** Query params for getActivity. Full parity with Data API. */
export interface ActivityParams {
  user: string;
  market?: string;
  eventId?: number;
  type?: string;
  side?: string;
  start?: number;
  end?: number;
  limit?: number;
  offset?: number;
  sortBy?: "TIMESTAMP" | "TOKENS" | "CASH";
  sortDirection?: "ASC" | "DESC";
}

/** Query params for getTrades (Data API). Full parity. */
export interface TradesParams {
  user?: string;
  market?: string;
  eventId?: number;
  side?: string;
  takerOnly?: boolean;
  filterType?: "CASH" | "TOKENS";
  filterAmount?: number;
  limit?: number;
  offset?: number;
}

export interface PositionsParams {
  user: string;
  market?: string;
  eventId?: number;
  sizeThreshold?: number;
  redeemable?: boolean;
  mergeable?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: "CURRENT" | "INITIAL" | "TOKENS" | "CASHPNL" | "PERCENTPNL" | "TITLE" | "RESOLVING" | "PRICE" | "AVGPRICE";
  sortDirection?: "ASC" | "DESC";
  title?: string;
}
