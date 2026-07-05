/**
 * Session wallet-state banner (puzzle 5 follow-up — agent address awareness).
 *
 * The banner reuses the exact read-side tool resolution
 * (resolveSelectedAddressSetForRead — mission setup is allowed to READ its own
 * wallet), so we mock that boundary and assert the banner's own contract: full
 * addresses, a clear "none selected" per unselected family, fail-soft on
 * active-run contract drift (never crashes the turn), no wallet ids/labels
 * leaked, and a re-throw for genuinely unexpected errors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EngineContext } from "@vex-agent/engine/types.js";

const mockResolveSelectedAddressSet = vi.fn();
vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddressSetForRead: (...a: unknown[]) => mockResolveSelectedAddressSet(...a),
}));

const { buildWalletStateBanner } = await import("@vex-agent/engine/prompts/wallet-state.js");
const { VexError, ErrorCodes } = await import("../../../../errors.js");

const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "So1anaFu11Address1111111111111111111111111";

function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return {
    sessionId: "s1",
    sessionKind: "agent",
    sessionPermission: "full",
    missionId: null,
    missionRunId: null,
    isSubagent: false,
    selectedEvmWallet: { id: "w-evm-id", address: EVM },
    selectedSolanaWallet: { id: "w-sol-id", address: SOL },
    walletPolicy: { kind: "none" },
    loadedDocuments: new Map(),
    ...over,
  } as EngineContext;
}

beforeEach(() => vi.clearAllMocks());

describe("buildWalletStateBanner", () => {
  it("shows both FULL addresses when both families are selected", () => {
    mockResolveSelectedAddressSet.mockReturnValue({ evm: EVM, solana: SOL, all: [EVM, SOL] });
    const banner = buildWalletStateBanner(ctx());
    expect(banner).toContain("# Session wallets"); // P3 heading fix: H2 → H1 (layer-consistent)
    expect(banner).toContain(EVM);
    expect(banner).toContain(SOL);
    expect(banner).not.toContain("…"); // never truncated
  });

  it("marks a family with no selection as 'none selected'", () => {
    mockResolveSelectedAddressSet.mockReturnValue({ evm: EVM, solana: null, all: [EVM] });
    const banner = buildWalletStateBanner(ctx({ selectedSolanaWallet: null }));
    expect(banner).toContain(EVM);
    expect(banner).toMatch(/Solana:\s*none selected/);
  });

  it("fails soft (no throw) on an invalid mission policy", () => {
    mockResolveSelectedAddressSet.mockImplementation(() => {
      throw new VexError(ErrorCodes.WALLET_SCOPE_MISMATCH, "contract drift");
    });
    const banner = buildWalletStateBanner(ctx({ walletPolicy: { kind: "invalid", reason: "drift" } }));
    expect(banner).toContain("# Session wallets"); // P3 heading fix: H2 → H1 (layer-consistent)
    expect(banner).toContain("fail closed");
    expect(banner).not.toContain(EVM);
  });

  it("never leaks wallet ids/labels (addresses only)", () => {
    mockResolveSelectedAddressSet.mockReturnValue({ evm: EVM, solana: SOL, all: [EVM, SOL] });
    const banner = buildWalletStateBanner(ctx());
    expect(banner).not.toContain("w-evm-id");
    expect(banner).not.toContain("w-sol-id");
  });

  it("re-throws a genuinely unexpected (non-scope) error", () => {
    mockResolveSelectedAddressSet.mockImplementation(() => { throw new Error("boom"); });
    expect(() => buildWalletStateBanner(ctx())).toThrow("boom");
  });
});
