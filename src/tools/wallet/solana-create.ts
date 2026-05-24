import { Keypair } from "@solana/web3.js";
import { autoBackup } from "./backup.js";
import { registerPrimaryLegacyWallet } from "./inventory.js";
import { VexError, ErrorCodes } from "../../errors.js";
import { requireKeystorePassword } from "../../utils/env.js";
import { deriveSolanaAddress, encryptSolanaSecretKey, saveSolanaKeystore, solanaKeystoreExists } from "./solana-keystore.js";

export interface SolanaWalletCreateResult {
  address: string;
  overwritten: boolean;
}

export async function createSolanaWallet(opts: { force?: boolean } = {}): Promise<SolanaWalletCreateResult> {
  const existed = solanaKeystoreExists();

  if (existed && !opts.force) {
    throw new VexError(
      ErrorCodes.KEYSTORE_ALREADY_EXISTS,
      "Solana keystore already exists.",
      "Use --force to overwrite. Existing keystore will be backed up automatically.",
    );
  }

  if (opts.force && existed) {
    await autoBackup();
  }

  const password = requireKeystorePassword();
  const keypair = Keypair.generate();
  const address = deriveSolanaAddress(keypair.secretKey);

  saveSolanaKeystore(encryptSolanaSecretKey(keypair.secretKey, password));
  registerPrimaryLegacyWallet("solana", address);

  return { address, overwritten: existed };
}
