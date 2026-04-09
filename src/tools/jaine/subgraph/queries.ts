/**
 * GraphQL query strings for Jaine V3 subgraph.
 * Plain strings — zero npm dependencies.
 */

import {
  POOL_FIELDS,
  TOKEN_FIELDS,
  POOL_DAY_DATA_FIELDS,
  POOL_HOUR_DATA_FIELDS,
  SWAP_FIELDS,
  MINT_FIELDS,
  BURN_FIELDS,
  COLLECT_FIELDS,
  DEX_DAY_DATA_FIELDS,
} from "./queries-fragments.js";

// --- Queries ---

export const META = `{
  _meta {
    block { number timestamp hash }
    deployment
    hasIndexingErrors
  }
}`;

export const POOLS_TOP_TVL = `query PoolsTopTvl($first: Int!, $skip: Int!) {
  pools(
    first: $first
    skip: $skip
    orderBy: totalValueLockedUSD
    orderDirection: desc
  ) {
    ${POOL_FIELDS}
  }
}`;

export const POOLS_FOR_TOKEN = `query PoolsForToken($token: Bytes!, $first: Int!, $skip: Int!) {
  pools(
    first: $first
    skip: $skip
    orderBy: totalValueLockedUSD
    orderDirection: desc
    where: { or: [{ token0: $token }, { token1: $token }] }
  ) {
    ${POOL_FIELDS}
  }
}`;

export const POOLS_FOR_PAIR = `query PoolsForPair($tokenA: Bytes!, $tokenB: Bytes!, $first: Int!, $skip: Int!) {
  pools(
    first: $first
    skip: $skip
    orderBy: totalValueLockedUSD
    orderDirection: desc
    where: { or: [
      { token0: $tokenA, token1: $tokenB },
      { token0: $tokenB, token1: $tokenA }
    ] }
  ) {
    ${POOL_FIELDS}
  }
}`;

export const NEWEST_POOLS = `query NewestPools($first: Int!) {
  pools(
    first: $first
    orderBy: createdAtTimestamp
    orderDirection: desc
  ) {
    ${POOL_FIELDS}
  }
}`;

export const POOL_GET = `query PoolGet($id: ID!) {
  pool(id: $id) {
    ${POOL_FIELDS}
  }
}`;

export const POOL_DAY_DATA = `query PoolDayData($poolId: String!, $first: Int!, $skip: Int!) {
  poolDayDatas(
    first: $first
    skip: $skip
    orderBy: date
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${POOL_DAY_DATA_FIELDS}
  }
}`;

export const POOL_HOUR_DATA = `query PoolHourData($poolId: String!, $first: Int!, $skip: Int!) {
  poolHourDatas(
    first: $first
    skip: $skip
    orderBy: periodStartUnix
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${POOL_HOUR_DATA_FIELDS}
  }
}`;

export const RECENT_SWAPS = `query RecentSwaps($poolId: String!, $first: Int!, $skip: Int!) {
  swaps(
    first: $first
    skip: $skip
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${SWAP_FIELDS}
  }
}`;

export const MINTS = `query Mints($poolId: String!, $first: Int!, $skip: Int!) {
  mints(
    first: $first
    skip: $skip
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${MINT_FIELDS}
  }
}`;

export const BURNS = `query Burns($poolId: String!, $first: Int!, $skip: Int!) {
  burns(
    first: $first
    skip: $skip
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${BURN_FIELDS}
  }
}`;

export const COLLECTS = `query Collects($poolId: String!, $first: Int!, $skip: Int!) {
  collects(
    first: $first
    skip: $skip
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${COLLECT_FIELDS}
  }
}`;

export const DEX_DAY_DATA = `query DexDayData($first: Int!) {
  jaineDexDayDatas(
    first: $first
    orderBy: date
    orderDirection: desc
  ) {
    ${DEX_DAY_DATA_FIELDS}
  }
}`;

export const TOKEN_INFO = `query TokenInfo($id: ID!) {
  token(id: $id) {
    ${TOKEN_FIELDS}
  }
}`;

export const TOP_TOKENS_BY_TVL = `query TopTokensByTvl($first: Int!, $skip: Int!) {
  tokens(
    first: $first
    skip: $skip
    orderBy: totalValueLockedUSD
    orderDirection: desc
  ) {
    ${TOKEN_FIELDS}
  }
}`;

export const TOP_TOKENS_BY_VOLUME = `query TopTokensByVolume($first: Int!, $skip: Int!) {
  tokens(
    first: $first
    skip: $skip
    orderBy: volumeUSD
    orderDirection: desc
  ) {
    ${TOKEN_FIELDS}
  }
}`;
