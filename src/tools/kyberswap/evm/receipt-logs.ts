/**
 * Pure functions for extracting token IDs from transaction receipt logs.
 * ERC-721 mint detection and ERC-1155 position extraction.
 */

// ── ERC-721 mint extraction from receipt ────────────────────────

const ERC721_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_ADDR_PADDED = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Extract NFT position ID from transaction receipt logs.
 *
 * Priority:
 * 1. Direct mint: Transfer(from=0x0, to=wallet, tokenId) — standard mint
 * 2. Router-intermediated: Transfer(from=any, to=wallet, tokenId) — router mints to
 *    itself first, then transfers to wallet. Only matches logs with 4 indexed topics
 *    (ERC-721, not ERC-20).
 */
export function extractMintedNftId(
  logs: Array<{ address: string; topics: string[]; data: string }>,
  recipientAddress: string,
  expectedContract?: string,
): string | undefined {
  const recipientPadded = `0x000000000000000000000000${recipientAddress.slice(2).toLowerCase()}`;
  const expectedLower = expectedContract?.toLowerCase();

  // Pass 1: direct mint (from=0x0 → wallet)
  for (const log of logs) {
    if (
      log.topics[0] === ERC721_TRANSFER_TOPIC &&
      log.topics.length === 4 &&
      log.topics[1] === ZERO_ADDR_PADDED &&
      log.topics[2]?.toLowerCase() === recipientPadded &&
      (!expectedLower || log.address.toLowerCase() === expectedLower)
    ) {
      return BigInt(log.topics[3]).toString();
    }
  }

  // Pass 2: router-intermediated (any → wallet, 4 topics = ERC-721)
  for (const log of logs) {
    if (
      log.topics[0] === ERC721_TRANSFER_TOPIC &&
      log.topics.length === 4 &&
      log.topics[1] !== ZERO_ADDR_PADDED &&
      log.topics[2]?.toLowerCase() === recipientPadded &&
      (!expectedLower || log.address.toLowerCase() === expectedLower)
    ) {
      return BigInt(log.topics[3]).toString();
    }
  }

  return undefined;
}

// ── ERC-1155 position extraction from receipt ──────────────────────

const ERC1155_TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const ERC1155_TRANSFER_BATCH_TOPIC = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

/**
 * Extract ERC-1155 position token ID from receipt logs.
 * Looks for TransferSingle or TransferBatch events where `to` is the recipient.
 */
export function extractErc1155Position(
  logs: Array<{ address: string; topics: string[]; data: string }>,
  recipientAddress: string,
): string | undefined {
  const recipientPadded = `0x000000000000000000000000${recipientAddress.slice(2).toLowerCase()}`;

  // TransferSingle(operator, from, to, id, value) — to is topics[3]
  for (const log of logs) {
    if (
      log.topics[0] === ERC1155_TRANSFER_SINGLE_TOPIC &&
      log.topics.length === 4 &&
      log.topics[3]?.toLowerCase() === recipientPadded
    ) {
      // id is in data[0:32]
      const id = BigInt("0x" + log.data.slice(2, 66));
      return id.toString();
    }
  }

  // TransferBatch(operator, from, to, ids[], values[]) — to is topics[3]
  for (const log of logs) {
    if (
      log.topics[0] === ERC1155_TRANSFER_BATCH_TOPIC &&
      log.topics.length === 4 &&
      log.topics[3]?.toLowerCase() === recipientPadded
    ) {
      // For batch, take the first id from the ABI-encoded array
      // Offset to ids array starts at data position 0 (offset pointer), then length, then first element
      try {
        const dataHex = log.data.slice(2);
        const idsOffset = Number(BigInt("0x" + dataHex.slice(0, 64))) * 2;
        const firstId = BigInt("0x" + dataHex.slice(idsOffset + 64, idsOffset + 128));
        return firstId.toString();
      } catch {
        continue;
      }
    }
  }

  return undefined;
}
