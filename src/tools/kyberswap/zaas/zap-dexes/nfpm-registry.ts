/**
 * NFPM address registry + shared 5-axis tuples for ZaaS DEX catalog.
 *
 * Single source of truth for:
 * 1. NonfungiblePositionManager addresses per (chain, dexId) — immutable deployed contracts
 * 2. Shared 5-axis position model tuples (extracted from 13 chain configs per §2.3)
 *
 * Sources: official docs, GitHub deployments, block explorer verification.
 * Last verified: 2026-04-04.
 */

// ── NFPM registry: (chain:dexId) → address ─────────────────────────

const NFPM: ReadonlyMap<string, string> = new Map([
  // Uniswap V3 — CREATE2 on original chains, different deployer on newer ones
  ["ethereum:DEX_UNISWAPV3",   "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
  ["polygon:DEX_UNISWAPV3",    "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
  ["arbitrum:DEX_UNISWAPV3",   "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
  ["optimism:DEX_UNISWAPV3",   "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
  ["base:DEX_UNISWAPV3",       "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"],
  ["bsc:DEX_UNISWAPV3",        "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613"],
  ["avalanche:DEX_UNISWAPV3",  "0x655C406EBFa14EE2006250925e54ec43AD184f8B"],

  // Uniswap V4 — PositionManager (ERC-721), unique per chain
  ["ethereum:DEX_UNISWAP_V4",  "0xbD216513d74c8cf14cf4747E6AaA6420FF64ee9e"],
  ["polygon:DEX_UNISWAP_V4",   "0x1Ec2ebf4F37e7363fDfe3551602425aF0B3ceEf9"],
  ["arbitrum:DEX_UNISWAP_V4",  "0xd88F38F930b7952f2DB2432Cb002E7aBBF3dD869"],
  ["optimism:DEX_UNISWAP_V4",  "0x3C3ea4b57a46241e54610e5f022E5c45859a1017"],
  ["base:DEX_UNISWAP_V4",      "0x7C5f5a4bBd8fD63184577525326123B519429bDC"],
  ["bsc:DEX_UNISWAP_V4",       "0x7A4a5c919ae2541AeD11041a1aEeE68f1287f95b"],
  ["avalanche:DEX_UNISWAP_V4", "0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd"],

  // PancakeSwap V3 — CREATE3, same address all chains
  ["ethereum:DEX_PANCAKESWAPV3", "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364"],
  ["arbitrum:DEX_PANCAKESWAPV3", "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364"],
  ["base:DEX_PANCAKESWAPV3",     "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364"],
  ["bsc:DEX_PANCAKESWAPV3",      "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364"],
  ["linea:DEX_PANCAKESWAPV3",    "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364"],

  // SushiSwap V3 (clAMM) — unique per chain, Base+Linea share address
  ["ethereum:DEX_SUSHISWAPV3",  "0x2214A42d8e2A1d20635c2cb0664422c528b6a432"],
  ["polygon:DEX_SUSHISWAPV3",   "0xb7402ee99F0A008e461098AC3A27F4957Df89a40"],
  ["arbitrum:DEX_SUSHISWAPV3",  "0xF0cBce1942A68BEB3d1b73F0dd86C8DCc363eF49"],
  ["optimism:DEX_SUSHISWAPV3",  "0x1af415a1EBA07a4986a52B6f2e7dE7003D82231e"],
  ["base:DEX_SUSHISWAPV3",      "0x80C7DD17B01855a6D2347444a0FCC36136a314de"],
  ["bsc:DEX_SUSHISWAPV3",       "0xF70c086618dcf2b1A461311275e00D6B722ef914"],
  ["avalanche:DEX_SUSHISWAPV3", "0x18350b048AB366ed601fFDbC669110Ecb36016f3"],
  ["linea:DEX_SUSHISWAPV3",     "0x80C7DD17B01855a6D2347444a0FCC36136a314de"],
  ["scroll:DEX_SUSHISWAPV3",    "0x0389879e0156033202C44BF784ac18fC02edeE4f"],

  // Algebra-based
  ["polygon:DEX_QUICKSWAPV3ALGEBRA",   "0x8eF88E4c7CfbbaC1C163f7eddd4B578792201de6"],
  ["arbitrum:DEX_CAMELOTV3",           "0x00c7f3082833e796A5b3e4Bd59f6642FF44DCD15"],
  ["bsc:DEX_THENAALGEBRAINTEGRAL",     "0xa51ADb08Cbe6Ae398046A23bec013979816B77Ab"],

  // ve(3,3) — adapted NFPM for Slipstream/CL
  ["arbitrum:DEX_RAMSESCL",             "0xAA277CB7914b7e5514946Da92cb9De332Ce610EF"],
  ["base:DEX_AERODROMECL",              "0x827922686190790b37229fd06084350E74485b72"],
  ["optimism:DEX_VELODROME_SLIPSTREAM", "0x416b433906b1B72FA758e166e239c43d68dC6F29"],
  ["sonic:DEX_SHADOW_CL",               "0x12E66C8F215DdD5d48d150c8f46aD0c6fB0F4406"],

  // Chain-specific
  ["linea:DEX_LINEHUBV3",     "0xD27166FA3E2c1a2C1813d0fe6226b8EB21783184"],
  ["zksync:DEX_KOICL",        "0xa459EbF3E6A6d5875345f725bA3F107340b67732"],
  ["zksync:DEX_SYNCSWAP_V3",  "0x7581A80c84D7488BE276E6c7b4c1206F25946502"],
  ["berachain:DEX_KODIAK_V3", "0xFE5E8C83FFE4d9627A75EaA7Fee864768dB989bD"],
  ["ronin:DEX_KATANA_V3",     "0x7C2716803c09cd5eeD78Ba40117084af3c803565"],
]);

/** Get NFPM address for a DEX on a chain. Undefined = not in registry. */
export function getNfpm(chain: string, dexId: string): string | undefined {
  return NFPM.get(`${chain}:${dexId}`);
}

// ── Shared 5-axis tuples ────────────────────────────────────────────

export const NFT_CL = {
  positionRefKind: "tokenId",
  approvalStandard: "erc721",
  approvalTargetKind: "positionManager",
  captureKind: "receiptNftMint",
  positionKeyStrategy: "nftTokenId",
} as const;

export const V2_BASIC = {
  positionRefKind: "ownerAddress",
  approvalStandard: "erc20",
  approvalTargetKind: "poolAddress",
  captureKind: "shareBalance",
  positionKeyStrategy: "chainPoolWallet",
} as const;

export const VAULT_SHARE = {
  positionRefKind: "ownerAddress",
  approvalStandard: "erc20",
  approvalTargetKind: "vaultShare",
  captureKind: "shareBalance",
  positionKeyStrategy: "chainVaultWallet",
} as const;

export const SOURCE_ONLY_SHARE = {
  positionRefKind: "ownerAddress",
  approvalStandard: "erc20",
  approvalTargetKind: "lpToken",
  captureKind: "none",
  positionKeyStrategy: "none",
} as const;
