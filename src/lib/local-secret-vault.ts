import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { z } from "zod";
import { ENV_FILE, SECRETS_VAULT_FILE } from "../config/paths.js";
import { removeFromDotenvFile } from "../utils/dotenv.js";
import {
  MANAGED_SECRET_ENV_KEYS,
  VAULT_SECRET_KEYS,
  type VaultSecretKey,
} from "./secret-keys.js";

const VAULT_VERSION = 1;
/**
 * Current scrypt KDF parameters used when encrypting new vaults or rewriting
 * existing ones. N=65536 is a deliberate compromise between OWASP guidance
 * (scrypt p=1 N>=2^17 ~ 400ms unlock) and an interactive desktop unlock
 * latency target (~200ms on commodity hardware).
 *
 * Vault files carry their own `kdf` block so older files remain decryptable
 * with their original params; `unlockSecretVault` opportunistically rewrites
 * them with `CURRENT_KDF_PARAMS` on a successful decrypt.
 */
export const CURRENT_KDF_PARAMS = {
  name: "scrypt",
  N: 65536,
  r: 8,
  p: 1,
  dkLen: 32,
} as const;

const vaultFileSchema = z
  .object({
    version: z.literal(VAULT_VERSION),
    kdf: z
      .object({
        name: z.literal("scrypt"),
        N: z.number().int().positive(),
        r: z.number().int().positive(),
        p: z.number().int().positive(),
        dkLen: z.literal(32),
      })
      .strict(),
    salt: z.string().min(1),
    iv: z.string().min(1),
    tag: z.string().min(1),
    ciphertext: z.string().min(1),
  })
  .strict();

const vaultContentsSchema = z
  .object({
    version: z.literal(VAULT_VERSION),
    secrets: z
      .partialRecord(z.enum(VAULT_SECRET_KEYS), z.string().min(1))
      .default({}),
  })
  .strict();

type VaultFile = z.infer<typeof vaultFileSchema>;

export interface LocalSecretVaultOptions {
  readonly filePath?: string;
}

export interface LocalSecretVaultStatus {
  readonly configured: boolean;
}

export interface LocalSecretVaultContents {
  readonly version: typeof VAULT_VERSION;
  readonly secrets: Partial<Record<VaultSecretKey, string>>;
}

export class LocalSecretVaultError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid_password" | "corrupt" | "io",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LocalSecretVaultError";
  }
}

function resolveVaultPath(options: LocalSecretVaultOptions): string {
  return options.filePath ?? SECRETS_VAULT_FILE;
}

function deriveKey(password: string, salt: Buffer, params: VaultFile["kdf"]): Buffer {
  // Node's scrypt enforces a soft memory cap of 32 MiB by default; once N
  // exceeds 2^15 (with r=8, p=1) the buffer requirement passes that cap and
  // the call fails with `digital envelope routines::memory limit exceeded`.
  // Raise the ceiling to 256 MiB — enough headroom for any KDF params we
  // currently target, and still well within reasonable bounds for a desktop
  // unlock operation.
  const maxmem = 256 * 1024 * 1024;
  return scryptSync(password, salt, params.dkLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem,
  });
}

function emptyContents(): LocalSecretVaultContents {
  return { version: VAULT_VERSION, secrets: {} };
}

function parseVaultFile(raw: string): VaultFile {
  try {
    return vaultFileSchema.parse(JSON.parse(raw));
  } catch (cause) {
    throw new LocalSecretVaultError("Secret vault file is corrupt.", "corrupt", cause);
  }
}

function encryptContents(
  contents: LocalSecretVaultContents,
  password: string,
): VaultFile {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt, CURRENT_KDF_PARAMS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(contents), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: VAULT_VERSION,
    kdf: CURRENT_KDF_PARAMS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function vaultFileNeedsKdfUpgrade(file: VaultFile): boolean {
  return (
    file.kdf.N !== CURRENT_KDF_PARAMS.N ||
    file.kdf.r !== CURRENT_KDF_PARAMS.r ||
    file.kdf.p !== CURRENT_KDF_PARAMS.p ||
    file.kdf.dkLen !== CURRENT_KDF_PARAMS.dkLen
  );
}

function decryptContents(file: VaultFile, password: string): LocalSecretVaultContents {
  try {
    const salt = Buffer.from(file.salt, "base64");
    const iv = Buffer.from(file.iv, "base64");
    const tag = Buffer.from(file.tag, "base64");
    const ciphertext = Buffer.from(file.ciphertext, "base64");
    const key = deriveKey(password, salt, file.kdf);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const parsed = vaultContentsSchema.parse(JSON.parse(plaintext));
    return { version: parsed.version, secrets: parsed.secrets };
  } catch (cause) {
    throw new LocalSecretVaultError(
      "Secret vault could not be unlocked.",
      "invalid_password",
      cause,
    );
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmp = join(dir, `.secrets.vault.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmp, filePath);
    chmodSync(filePath, 0o600);
  } catch (cause) {
    throw new LocalSecretVaultError("Could not write secret vault.", "io", cause);
  }
}

export function secretVaultExists(options: LocalSecretVaultOptions = {}): boolean {
  return existsSync(resolveVaultPath(options));
}

export function getSecretVaultStatus(
  options: LocalSecretVaultOptions = {},
): LocalSecretVaultStatus {
  return { configured: secretVaultExists(options) };
}

export function createSecretVault(
  password: string,
  options: LocalSecretVaultOptions = {},
): LocalSecretVaultContents {
  const filePath = resolveVaultPath(options);
  if (existsSync(filePath)) {
    return unlockSecretVault(password, options);
  }

  const contents = emptyContents();
  atomicWriteJson(filePath, encryptContents(contents, password));
  return contents;
}

/**
 * Verify the master password against the on-disk vault without unlocking the
 * session, upgrading KDF params, or returning the decrypted payload. Used for
 * sudo-style re-authentication on sensitive ops (e.g. wallet private-key
 * export) that should NOT mutate session state or write to disk.
 *
 * Throws `LocalSecretVaultError` with code:
 *   - "missing"          — vault file does not exist
 *   - "corrupt"          — file present but JSON/schema-invalid
 *   - "invalid_password" — bit-flipped ciphertext / auth-tag mismatch is
 *                          indistinguishable from a wrong password; this
 *                          covers both cases. Reserved "corrupt" for
 *                          structurally-invalid file shape only (parseVaultFile).
 *
 * Returns `undefined` on success — by design no secrets are returned.
 * No disk write on success or failure (no opportunistic KDF upgrade).
 */
export function verifySecretVaultPassword(
  password: string,
  options: LocalSecretVaultOptions = {},
): void {
  const filePath = resolveVaultPath(options);
  if (!existsSync(filePath)) {
    throw new LocalSecretVaultError("Secret vault is not configured.", "missing");
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new LocalSecretVaultError("Could not read secret vault.", "io", cause);
  }

  // parseVaultFile raises `corrupt` on JSON/schema failure — surface as-is.
  const parsedFile = parseVaultFile(raw);

  // decryptContents wraps any AES-GCM/scrypt failure as `invalid_password`.
  // Discard the decrypted payload — verification only needs to confirm the
  // password unwraps the vault; callers MUST NOT use this to harvest secrets.
  decryptContents(parsedFile, password);
}

export function unlockSecretVault(
  password: string,
  options: LocalSecretVaultOptions = {},
): LocalSecretVaultContents {
  const filePath = resolveVaultPath(options);
  if (!existsSync(filePath)) {
    throw new LocalSecretVaultError("Secret vault is not configured.", "missing");
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new LocalSecretVaultError("Could not read secret vault.", "io", cause);
  }
  const parsedFile = parseVaultFile(raw);
  const contents = decryptContents(parsedFile, password);

  // Opportunistically re-encrypt with CURRENT_KDF_PARAMS when the on-disk
  // params are weaker (or otherwise drift from the current scheme). A failure
  // here MUST NOT block unlock — the caller still has correctly decrypted
  // secrets; the next successful unlock or write will retry the rewrite.
  if (vaultFileNeedsKdfUpgrade(parsedFile)) {
    try {
      atomicWriteJson(filePath, encryptContents(contents, password));
    } catch (cause) {
      // Surface via process.emitWarning instead of pulling in a logger
      // dependency at this layer; secret-session.ts already wraps callers
      // in a try/catch that maps LocalSecretVaultError. Mirrors the existing
      // best-effort pattern used elsewhere in this module.
      process.emitWarning(
        `Secret vault KDF upgrade rewrite failed; vault still usable with stale params: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { type: "LocalSecretVaultKdfUpgrade" },
      );
    }
  }

  return contents;
}

export function writeSecretVaultSecrets(
  password: string,
  updates: Partial<Record<VaultSecretKey, string | null>>,
  options: LocalSecretVaultOptions = {},
): LocalSecretVaultContents {
  const current = secretVaultExists(options)
    ? unlockSecretVault(password, options)
    : createSecretVault(password, options);
  const nextSecrets: Partial<Record<VaultSecretKey, string>> = {
    ...current.secrets,
  };

  for (const key of VAULT_SECRET_KEYS) {
    if (!(key in updates)) continue;
    const value = updates[key];
    if (typeof value === "string" && value.length > 0) nextSecrets[key] = value;
    else delete nextSecrets[key];
  }

  const next: LocalSecretVaultContents = {
    version: VAULT_VERSION,
    secrets: nextSecrets,
  };
  atomicWriteJson(resolveVaultPath(options), encryptContents(next, password));
  return next;
}

export function applySecretVaultToProcessEnv(
  password: string,
  options: LocalSecretVaultOptions = {},
): LocalSecretVaultContents {
  const contents = unlockSecretVault(password, options);
  for (const key of VAULT_SECRET_KEYS) {
    const value = contents.secrets[key];
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
  return contents;
}

export function stripManagedSecretsFromDotenvFile(envPath = ENV_FILE): void {
  for (const key of MANAGED_SECRET_ENV_KEYS) {
    removeFromDotenvFile(key, envPath);
  }
}
