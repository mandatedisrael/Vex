/**
 * GraphQL fragment strings for Jaine V3 subgraph.
 * Shared field selections reused across multiple queries.
 */

export const POOL_FIELDS = `
  id
  createdAtTimestamp
  createdAtBlockNumber
  token0 { id symbol name decimals }
  token1 { id symbol name decimals }
  feeTier
  liquidity
  sqrtPrice
  token0Price
  token1Price
  tick
  observationIndex
  volumeToken0
  volumeToken1
  volumeUSD
  feesUSD
  txCount
  totalValueLockedToken0
  totalValueLockedToken1
  totalValueLockedUSD
  totalValueLockedETH
  liquidityProviderCount
`;

export const TOKEN_FIELDS = `
  id
  symbol
  name
  decimals
  totalSupply
  volume
  volumeUSD
  untrackedVolumeUSD
  feesUSD
  txCount
  poolCount
  totalValueLocked
  totalValueLockedUSD
  totalValueLockedUSDUntracked
  derivedETH
`;

export const POOL_DAY_DATA_FIELDS = `
  id
  date
  pool { id }
  liquidity
  sqrtPrice
  token0Price
  token1Price
  tick
  tvlUSD
  volumeToken0
  volumeToken1
  volumeUSD
  feesUSD
  txCount
  open high low close
`;

export const POOL_HOUR_DATA_FIELDS = `
  id
  periodStartUnix
  pool { id }
  liquidity
  sqrtPrice
  token0Price
  token1Price
  tick
  tvlUSD
  volumeToken0
  volumeToken1
  volumeUSD
  feesUSD
  txCount
  open high low close
`;

export const SWAP_FIELDS = `
  id
  timestamp
  pool { id }
  token0 { id symbol }
  token1 { id symbol }
  sender
  recipient
  origin
  amount0
  amount1
  amountUSD
  sqrtPriceX96
  tick
`;

export const MINT_FIELDS = `
  id
  timestamp
  pool { id }
  token0 { id symbol }
  token1 { id symbol }
  owner
  sender
  origin
  amount
  amount0
  amount1
  amountUSD
  tickLower
  tickUpper
`;

export const BURN_FIELDS = `
  id
  timestamp
  pool { id }
  token0 { id symbol }
  token1 { id symbol }
  owner
  origin
  amount
  amount0
  amount1
  amountUSD
  tickLower
  tickUpper
`;

export const COLLECT_FIELDS = `
  id
  timestamp
  pool { id }
  owner
  amount0
  amount1
  amountUSD
  tickLower
  tickUpper
`;

export const DEX_DAY_DATA_FIELDS = `
  id
  date
  volumeETH
  volumeUSD
  volumeUSDUntracked
  feesUSD
  txCount
  tvlUSD
`;
