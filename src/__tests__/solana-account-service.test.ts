import { describe, expect, it, vi, beforeEach } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";

const mockGetTokenAccountsByOwner = vi.fn();
const mockGetBalance = vi.fn();

vi.mock("../tools/chains/solana/connection.js", () => ({
  getSolanaConnection: () => ({
    getTokenAccountsByOwner: mockGetTokenAccountsByOwner,
    getBalance: mockGetBalance,
  }),
}));

// getAccount from @solana/spl-token receives (connection, pubkey) — mock must handle both args
const mockGetAccount = vi.fn();
vi.mock("@solana/spl-token", () => ({
  TOKEN_PROGRAM_ID: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  createBurnInstruction: vi.fn(() => ({ programId: "burn", keys: [], data: Buffer.alloc(0) })),
  createCloseAccountInstruction: vi.fn(() => ({ programId: "close", keys: [], data: Buffer.alloc(0) })),
  getAccount: (...args: unknown[]) => mockGetAccount(...args),
}));

const mockSignAndSendLegacy = vi.fn(() => "acct-sig");
vi.mock("../tools/chains/solana/tx.js", () => ({
  signAndSendLegacyTx: (...args: unknown[]) => mockSignAndSendLegacy(...args),
}));

vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" } }),
}));

const { closeEmptyAccounts } = await import("../tools/chains/solana/account-service.js");

const testKeypair = Keypair.generate();

describe("account service", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("closeEmptyAccounts", () => {
    it("returns zeros when no token accounts", async () => {
      mockGetTokenAccountsByOwner.mockResolvedValueOnce({ value: [] });

      const result = await closeEmptyAccounts(testKeypair.secretKey);
      expect(result.closed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.signatures).toEqual([]);
    });

    it("closes empty accounts and returns rent reclaimed", async () => {
      const fakePubkey = Keypair.generate().publicKey;
      mockGetTokenAccountsByOwner.mockResolvedValueOnce({
        value: [{ pubkey: fakePubkey, account: { data: Buffer.alloc(165) } }],
      });
      // getAccount(connection, pubkey) — returns token account info with amount=0 (empty)
      mockGetAccount.mockResolvedValueOnce({ amount: BigInt(0) });
      mockGetBalance.mockResolvedValueOnce(2_039_280); // rent in lamports
      mockSignAndSendLegacy.mockResolvedValueOnce("close-sig");

      const result = await closeEmptyAccounts(testKeypair.secretKey);
      expect(result.closed).toBe(1);
      expect(result.rentReclaimedSol).toBeGreaterThan(0);
      expect(result.signatures).toEqual(["close-sig"]);
    });

    it("skips non-empty accounts", async () => {
      const fakePubkey = Keypair.generate().publicKey;
      mockGetTokenAccountsByOwner.mockResolvedValueOnce({
        value: [{ pubkey: fakePubkey, account: { data: Buffer.alloc(165) } }],
      });
      mockGetAccount.mockResolvedValueOnce({ amount: BigInt(1000) }); // not empty

      const result = await closeEmptyAccounts(testKeypair.secretKey);
      expect(result.closed).toBe(0);
    });

    it("handles getAccount failure gracefully", async () => {
      const fakePubkey = Keypair.generate().publicKey;
      mockGetTokenAccountsByOwner.mockResolvedValueOnce({
        value: [{ pubkey: fakePubkey, account: { data: Buffer.alloc(165) } }],
      });
      mockGetAccount.mockRejectedValueOnce(new Error("parse error"));

      const result = await closeEmptyAccounts(testKeypair.secretKey);
      expect(result.closed).toBe(0); // skipped unparseable account
    });
  });
});
