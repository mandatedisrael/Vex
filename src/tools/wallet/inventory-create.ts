/**
 * Wallet inventory mutations — create / import / export. Puzzle 5 stage 1.
 *
 * New (non-legacy) wallets get a `wallet-<id>.json` keystore under CONFIG_DIR
 * and append to the per-family inventory after the cap + duplicate checks.
 * These functions hold key material only transiently (encrypt → write file);
 * they never return private keys. The CLI `vex wallet create/import` legacy
 * write-paths are separate (fixed keystore + `registerPrimaryLegacyWallet`).
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

import { Keypair } from "@solana/web3.js";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import type { KeystoreV1 } from "./keystore.js";

import { CONFIG_FILE } from "../../config/paths.js";
import {
  loadConfig,
  saveConfig,
  type VexConfig,
  type WalletInventoryEntry,
} from "../../config/store.js";
import { requireKeystorePassword } from "../../utils/env.js";
import { encryptPrivateKey, normalizePrivateKey, saveKeystoreFile } from "./keystore.js";
import {
  deriveSolanaAddress,
  encryptSolanaSecretKey,
  normalizeSolanaSecretKey,
} from "./solana-keystore.js";
import {
  assertCanAddWallet,
  derivePath,
  generateWalletId,
  type InventoryFamily,
} from "./inventory.js";

function defaultLabel(family: InventoryFamily, cfg: VexConfig): string {
  const n = cfg.wallet[family].length + 1;
  return family === "solana" ? `Solana ${n}` : `EVM ${n}`;
}

/**
 * Shared tail: validate cap+duplicate, mint a non-reusable id, write the
 * derived keystore, append, persist. Returns the entry (no key material).
 */
function appendWalletEntry(
  family: InventoryFamily,
  address: string,
  keystore: KeystoreV1,
  label?: string,
): WalletInventoryEntry {
  const cfg = loadConfig();
  assertCanAddWallet(family, address, cfg);
  const entry: WalletInventoryEntry = {
    id: generateWalletId(family),
    address,
    label: label?.trim() || defaultLabel(family, cfg),
    createdAt: new Date().toISOString(),
  };
  saveKeystoreFile(derivePath(family, entry), keystore);
  cfg.wallet[family] = [...cfg.wallet[family], entry];
  saveConfig(cfg);
  return entry;
}

export function createEvmWalletEntry(opts: { label?: string } = {}): WalletInventoryEntry {
  const password = requireKeystorePassword();
  const privateKey = generatePrivateKey();
  const address = privateKeyToAddress(privateKey);
  return appendWalletEntry("evm", address, encryptPrivateKey(privateKey, password), opts.label);
}

export function importEvmWalletEntry(
  rawKey: string,
  opts: { label?: string } = {},
): WalletInventoryEntry {
  const password = requireKeystorePassword();
  const normalized = normalizePrivateKey(rawKey);
  const address = privateKeyToAddress(normalized);
  return appendWalletEntry("evm", address, encryptPrivateKey(normalized, password), opts.label);
}

export function createSolanaWalletEntry(opts: { label?: string } = {}): WalletInventoryEntry {
  const password = requireKeystorePassword();
  const keypair = Keypair.generate();
  const address = deriveSolanaAddress(keypair.secretKey);
  return appendWalletEntry(
    "solana",
    address,
    encryptSolanaSecretKey(keypair.secretKey, password),
    opts.label,
  );
}

export function importSolanaWalletEntry(
  rawKey: string,
  opts: { label?: string } = {},
): WalletInventoryEntry {
  const password = requireKeystorePassword();
  const secret = normalizeSolanaSecretKey(rawKey);
  const address = deriveSolanaAddress(secret);
  return appendWalletEntry("solana", address, encryptSolanaSecretKey(secret, password), opts.label);
}

/**
 * Copy config + every referenced keystore file into `destDir` for backup.
 * Keystores are encrypted on disk; the RETURN value is filenames only — no key
 * material ever leaves this process through the return path.
 */
export function exportAllWallets(destDir: string): { files: string[] } {
  mkdirSync(destDir, { recursive: true });
  const cfg = loadConfig();
  const files: string[] = [];

  if (existsSync(CONFIG_FILE)) {
    cpSync(CONFIG_FILE, join(destDir, "config.json"));
    files.push("config.json");
  }

  for (const family of ["evm", "solana"] as const) {
    for (const entry of cfg.wallet[family]) {
      const src = derivePath(family, entry);
      if (!existsSync(src)) continue;
      const base = basename(src);
      cpSync(src, join(destDir, base));
      if (!files.includes(base)) files.push(base);
    }
  }

  return { files };
}
