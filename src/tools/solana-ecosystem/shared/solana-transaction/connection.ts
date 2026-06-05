/**
 * Cached Solana `Connection` singleton for the Jupiter shelves.
 */

import { Connection, type Commitment } from "@solana/web3.js";
import { loadConfig } from "../../../../config/store.js";

// ── Connection singleton ────────────────────────────────────────

let connectionInstance: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (connectionInstance) return connectionInstance;

  const cfg = loadConfig();
  const rpcUrl = cfg.solana.rpcUrl;
  const commitment = (cfg.solana.commitment ?? "confirmed") as Commitment;

  connectionInstance = new Connection(rpcUrl, commitment);
  return connectionInstance;
}

export function resetSolanaConnection(): void {
  connectionInstance = null;
}
