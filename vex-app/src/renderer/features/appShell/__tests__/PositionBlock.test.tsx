/**
 * POSITION block — pins the zero-balance display rules:
 *
 *   - token rows whose USD would render as `$0.00` (|USD| < 0.005, i.e.
 *     below formatUsd's 2-decimal rounding threshold) never render,
 *   - the threshold matches formatUsd exactly: 0.004 hides, 0.006 shows,
 *   - the 8-row cap and "+N more" tail count only displayable rows,
 *   - when the wallet has tokens but ALL of them round to $0.00, a single
 *     muted "No priced balances." line replaces the list (the truly-empty
 *     "No token balances." copy is reserved for zero token rows),
 *   - totals stay untouched — they reflect the full portfolio.
 *
 * `usePortfolio` is mocked — this suite owns the block's display rules,
 * not the query wiring.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type {
  PortfolioDto,
  PositionChainDto,
  PositionTokenDto,
} from "@shared/schemas/portfolio.js";

const mockUsePortfolio = vi.hoisted(() => vi.fn());
const mockUseSessionWallets = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api/portfolio.js", () => ({
  usePortfolio: mockUsePortfolio,
}));

vi.mock("../../../lib/api/session-wallets.js", () => ({
  useSessionWallets: mockUseSessionWallets,
}));

const { PositionBlock } = await import("../book/PositionBlock.js");

// jsdom has no <dialog> methods — the "see more" networks dialog needs them.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModalPolyfill(this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function closePolyfill(this: HTMLDialogElement): void {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

function token(
  symbol: string,
  balanceUsd: number,
  chainId: number | null = 1,
): PositionTokenDto {
  return { chainId, symbol, balanceUsd };
}

function portfolio(overrides: Partial<PortfolioDto> = {}): PortfolioDto {
  return {
    scope: "global",
    walletCount: 2,
    liveTotalUsd: 123.45,
    snapshotTotalUsd: null,
    pnlVsPrev: null,
    snapshotAt: null,
    tokens: [],
    chains: [],
    ...overrides,
  };
}

function mockPortfolio(dto: PortfolioDto): void {
  mockUsePortfolio.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { ok: true, data: dto },
  });
}

function mockSessionWallets(
  evmAddr: string | null,
  solAddr: string | null,
): void {
  mockUseSessionWallets.mockReturnValue({
    isLoading: false,
    isError: false,
    data: {
      ok: true,
      data: {
        evm: evmAddr ? { walletId: "evm_1", address: evmAddr, label: "Main" } : null,
        solana: solAddr
          ? { walletId: "sol_1", address: solAddr, label: "Sol" }
          : null,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Global-scope suites never render the session body; a benign default keeps
  // the hook harmless when a test forgets to script it.
  mockUseSessionWallets.mockReturnValue({
    isLoading: true,
    isError: false,
    data: undefined,
  });
});

describe("PositionBlock zero-balance display", () => {
  it("hides token rows that would render as $0.00", () => {
    mockPortfolio(
      portfolio({
        tokens: [
          token("SOL", 12.3),
          token("GABECUBE", 0),
          token("AWSTIN", 0.0001),
        ],
      }),
    );
    const { container } = render(<PositionBlock activeSessionId={null} />);

    expect(screen.getByText("SOL")).not.toBeNull();
    expect(screen.queryByText("GABECUBE")).toBeNull();
    expect(screen.queryByText("AWSTIN")).toBeNull();
    // No figure anywhere on the block reads $0.00.
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("aligns the cut with formatUsd rounding: 0.004 hides, 0.006 shows as $0.01", () => {
    mockPortfolio(
      portfolio({
        tokens: [token("DUST", 0.004), token("EDGE", 0.006)],
      }),
    );
    render(<PositionBlock activeSessionId={null} />);

    expect(screen.queryByText("DUST")).toBeNull();
    expect(screen.getByText("EDGE")).not.toBeNull();
    expect(screen.getByText("$0.01")).not.toBeNull();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("shows 'No priced balances.' when every token rounds to $0.00", () => {
    mockPortfolio(
      portfolio({
        tokens: [token("GABECUBE", 0), token("AWSTIN", -0.002)],
      }),
    );
    const { container } = render(<PositionBlock activeSessionId={null} />);

    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(screen.getByText("No priced balances.")).not.toBeNull();
    // The truly-empty copy stays reserved for a portfolio with NO token rows.
    expect(screen.queryByText("No token balances.")).toBeNull();
  });

  it("keeps 'No token balances.' for a portfolio with no token rows at all", () => {
    mockPortfolio(portfolio({ tokens: [] }));
    render(<PositionBlock activeSessionId={null} />);

    expect(screen.getByText("No token balances.")).not.toBeNull();
    expect(screen.queryByText("No priced balances.")).toBeNull();
  });

  it("caps at 8 rows and counts '+N more' AFTER filtering zero balances", () => {
    // 12 rows fetched: 10 displayable + 2 zero. Pre-filter counting would
    // say "+4 more"; the correct tail is 10 - 8 = "+2 more".
    const priced = Array.from({ length: 10 }, (_, i) =>
      token(`TOK${i}`, 5 + i),
    );
    const dust = [token("ZERO1", 0), token("ZERO2", 0.001)];
    mockPortfolio(portfolio({ tokens: [...priced, ...dust] }));
    const { container } = render(<PositionBlock activeSessionId={null} />);

    expect(container.querySelectorAll("li")).toHaveLength(8);
    expect(screen.getByText("+2 more")).not.toBeNull();
    expect(screen.queryByText("+4 more")).toBeNull();
  });

  it("keeps the live total on the FULL portfolio even when rows filter out", () => {
    mockPortfolio(
      portfolio({
        liveTotalUsd: 987.65,
        tokens: [token("GABECUBE", 0)],
      }),
    );
    render(<PositionBlock activeSessionId={null} />);

    expect(screen.getByText("$987.65")).not.toBeNull();
    expect(screen.getByText("No priced balances.")).not.toBeNull();
  });
});

// ── Session scope: deposit addresses + per-chain switcher (owner redesign) ──

const SESSION = "00000000-0000-4000-8000-00000000aaaa";
const EVM_ADDR = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const SOL_ADDR = "So11111111111111111111111111111111111111112";

function chain(
  chainId: number,
  family: "evm" | "solana",
  totalUsd: number,
  tokens: PositionChainDto["tokens"],
): PositionChainDto {
  return { chainId, family, totalUsd, tokens };
}

describe("PositionBlock session view (addresses + chains)", () => {
  it("renders copy-ready deposit addresses for both families", () => {
    mockSessionWallets(EVM_ADDR, SOL_ADDR);
    mockPortfolio(portfolio({ scope: "session" }));
    render(<PositionBlock activeSessionId={SESSION} />);

    // Truncated 6+4 forms with copy buttons (AddressDisplay).
    expect(screen.getByText("0xAAAA…aaaa")).not.toBeNull();
    expect(screen.getByText("So1111…1112")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Copy address" })).toHaveLength(2);
  });

  it("hides a family whose session wallet is absent", () => {
    mockSessionWallets(EVM_ADDR, null);
    mockPortfolio(portfolio({ scope: "session" }));
    render(<PositionBlock activeSessionId={SESSION} />);

    expect(screen.getByText("0xAAAA…aaaa")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Copy address" })).toHaveLength(1);
    // No Solana group either — the session simply has no Solana wallet.
    expect(screen.queryByText("Solana")).toBeNull();
  });

  it("defaults the EVM group to Ethereum with a quiet empty state at zero balance", () => {
    mockSessionWallets(EVM_ADDR, SOL_ADDR);
    // Funds on Base only — Ethereum still leads as the standing default.
    mockPortfolio(
      portfolio({
        scope: "session",
        chains: [chain(8453, "evm", 25, [{ symbol: "USDC", balanceUsd: 25 }])],
      }),
    );
    render(<PositionBlock activeSessionId={SESSION} />);

    expect(screen.getByText("Ethereum")).not.toBeNull();
    expect(screen.getByText("No assets on Ethereum")).not.toBeNull();
  });

  it("switches chains via the quick icons and shows that chain's top tokens", () => {
    mockSessionWallets(EVM_ADDR, null);
    mockPortfolio(
      portfolio({
        scope: "session",
        chains: [chain(8453, "evm", 25, [{ symbol: "USDC", balanceUsd: 25 }])],
      }),
    );
    render(<PositionBlock activeSessionId={SESSION} />);

    fireEvent.click(screen.getByRole("button", { name: "Show Base assets" }));
    // The brand SVGs carry their own <title> text, so the name can match
    // more than once — the header text is asserted as "at least one".
    expect(screen.getAllByText("Base").length).toBeGreaterThan(0);
    expect(screen.getByText("USDC")).not.toBeNull();
    // $25.00 legitimately appears twice: the chain total in the group header
    // AND the single USDC token row (the chain's whole balance is USDC).
    expect(screen.getAllByText("$25.00")).toHaveLength(2);
  });

  it("always offers 'more'; the dialog lists only funded networks", () => {
    mockSessionWallets(EVM_ADDR, null);
    mockPortfolio(
      portfolio({
        scope: "session",
        // Polygon (137) is not a quick chain — it appears ONLY in the dialog.
        chains: [chain(137, "evm", 5, [{ symbol: "POL", balanceUsd: 5 }])],
      }),
    );
    render(<PositionBlock activeSessionId={SESSION} />);

    fireEvent.click(screen.getByRole("button", { name: "more" }));
    expect(screen.getByText("Networks")).not.toBeNull();
    expect(screen.getAllByText("Polygon").length).toBeGreaterThan(0);
  });

  it("offers 'more' even when nothing beyond the quick set is funded (empty-state dialog)", () => {
    mockSessionWallets(EVM_ADDR, null);
    mockPortfolio(portfolio({ scope: "session", chains: [] }));
    render(<PositionBlock activeSessionId={SESSION} />);

    fireEvent.click(screen.getByRole("button", { name: "more" }));
    expect(screen.getByText("Networks")).not.toBeNull();
    expect(screen.getByText("No funded EVM networks yet.")).not.toBeNull();
  });

  it("heads the Solana group with its mark (sr-only name) and its top tokens", () => {
    mockSessionWallets(null, SOL_ADDR);
    mockPortfolio(
      portfolio({
        scope: "session",
        chains: [
          chain(20011000000, "solana", 60, [
            { symbol: "SOL", balanceUsd: 50 },
            { symbol: "BONK", balanceUsd: 10 },
          ]),
        ],
      }),
    );
    const { container } = render(<PositionBlock activeSessionId={SESSION} />);

    // Scope to the chains area — the deposit row above also captions "SOL".
    const chainsArea = container.querySelector(
      '[data-vex-area="position-chains"]',
    );
    expect(chainsArea).not.toBeNull();
    const chains = within(chainsArea as HTMLElement);
    // The visible label is the mark; the NAME survives for AT via sr-only.
    expect(chains.getByText("Solana")).not.toBeNull();
    expect(chains.getByText("SOL")).not.toBeNull();
    expect(chains.getByText("BONK")).not.toBeNull();
    // No EVM group at all — the session has no EVM wallet.
    expect(chains.queryByText("Ethereum")).toBeNull();
  });
});
