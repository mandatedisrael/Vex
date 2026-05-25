/**
 * Cross-boundary re-export so vex-app (Electron main) can pull the
 * canonical wallet primitives via `@vex-lib/wallet.js` without reaching
 * outside the alias scope (mirrors `src/lib/dotenv.ts` from M7).
 *
 * The implementations live under `src/tools/wallet/` and `src/cli/setup/`
 * and stay the single source of truth for keystore format, encryption
 * (AES-256-GCM + Scrypt), wallet generation, import validation, and
 * auto-backup retention. vex-shell and vex-app both consume the same
 * functions so the on-disk state remains compatible across clients.
 */

export {
  createWallet,
  type WalletCreateResult,
} from "../tools/wallet/create.js";
export {
  createSolanaWallet,
  type SolanaWalletCreateResult,
} from "../tools/wallet/solana-create.js";
export {
  importWallet,
  type WalletImportResult,
} from "../tools/wallet/import.js";
export {
  importSolanaWallet,
  type SolanaWalletImportResult,
} from "../tools/wallet/solana-import.js";

export {
  type KeystoreV1,
  decryptPrivateKey,
  decryptSecretBytes,
  encryptPrivateKey,
  encryptSecretBytes,
  keystoreExists,
  keystoreFileExists,
  loadKeystore,
  loadKeystoreFile,
  normalizePrivateKey,
  saveKeystore,
  saveKeystoreFile,
} from "../tools/wallet/keystore.js";

export {
  decryptSolanaSecretKey,
  deriveSolanaAddress,
  encodeSolanaSecretKey,
  encryptSolanaSecretKey,
  loadSolanaKeystore,
  normalizeSolanaSecretKey,
  saveSolanaKeystore,
  solanaKeystoreExists,
} from "../tools/wallet/solana-keystore.js";

export { autoBackup } from "../tools/wallet/backup.js";

export {
  type VexConfig,
  type WalletInventoryEntry,
  loadConfig,
  saveConfig,
} from "../config/store.js";

export {
  getPrimaryEvmAddress,
  getPrimaryEvmEntry,
  getPrimarySolanaAddress,
  getWalletById,
  listWallets,
  registerPrimaryLegacyWallet,
} from "../tools/wallet/inventory.js";

export {
  createEvmWalletEntry,
  importEvmWalletEntry,
  createSolanaWalletEntry,
  importSolanaWalletEntry,
  exportAllWallets,
} from "../tools/wallet/inventory-create.js";

export {
  BACKUPS_DIR,
  CONFIG_DIR as ENGINE_CONFIG_DIR,
  CONFIG_FILE,
  KEYSTORE_FILE,
  SOLANA_KEYSTORE_FILE,
} from "../config/paths.js";

export { ErrorCodes, VexError } from "../errors.js";

export { privateKeyToAddress } from "viem/accounts";
