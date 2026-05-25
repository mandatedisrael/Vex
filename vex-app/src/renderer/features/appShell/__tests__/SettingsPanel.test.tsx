/**
 * SettingsPanel tests (post-onboarding wallet management + Polymarket).
 *
 * The heavy wizard children (ChainActions, ExportAllWallets,
 * PolymarketAutoSetupSection) are mocked — they have their own suites; here
 * we verify SettingsPanel's own logic: it uses the wallet INVENTORY (not the
 * legacy `walletAddresses` env fields) as the source of truth, gates on both
 * the env-state and inventory queries, and host-wraps the Polymarket section
 * (EVM-only) on EVM inventory presence.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const mockSetAppShellView = vi.fn();
const mockOpenWizard = vi.fn();

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (
    selector: (s: {
      setAppShellView: typeof mockSetAppShellView;
      openWizard: typeof mockOpenWizard;
    }) => unknown,
  ) =>
    selector({
      setAppShellView: mockSetAppShellView,
      openWizard: mockOpenWizard,
    }),
}));

vi.mock("../../wizard/steps/wallets/ChainActions.js", () => ({
  ChainActions: ({
    chain,
    address,
  }: {
    readonly chain: string;
    readonly address: string | null;
  }) =>
    createElement("div", {
      "data-testid": `chain-actions-${chain}`,
      "data-address": address ?? "null",
    }),
}));
vi.mock("../../wizard/steps/wallets/ExportAllWallets.js", () => ({
  ExportAllWallets: () =>
    createElement("div", { "data-testid": "export-all-wallets" }),
}));
vi.mock("../../wizard/steps/polymarket-auto-setup/PolymarketAutoSetupSection.js", () => ({
  PolymarketAutoSetupSection: () =>
    createElement("div", { "data-testid": "polymarket-auto-setup" }),
}));

const { SettingsPanel } = await import("../SettingsPanel.js");

const getEnvStateMock = vi.fn();
const listAvailableMock = vi.fn();

function buildEnvState(over: { readonly unlocked?: boolean } = {}) {
  return {
    hasKeystorePassword: true,
    hasJupiterApiKey: false,
    apiKeys: {
      jupiterConfigured: false,
      tavilyConfigured: false,
      rettiwtConfigured: false,
      polymarketStatus: "missing",
    },
    secrets: { vaultConfigured: true, unlocked: over.unlocked ?? true },
    embeddings: {
      configured: true,
      reachable: true,
      baseUrlRedacted: null,
      allFieldsConfigured: true,
      dbReachable: true,
    },
    // Both reported present, and the legacy address fields are NULL — the
    // real multi-wallet config model does not write them back. SettingsPanel
    // must rely on the inventory, never these.
    walletStatus: { evm: "present", solana: "present" },
    walletAddresses: { evm: null, solana: null },
    provider: { configured: true, name: "openrouter", modelLabel: "x" },
    setupCompleteFlag: true,
  };
}

interface InvWallet {
  readonly id: string;
  readonly address: string;
  readonly label: string;
}
function evmWallet(address: string): InvWallet {
  return { id: `id-${address}`, address, label: "EVM Wallet" };
}
function buildInventory(
  over: { readonly evm?: readonly InvWallet[]; readonly solana?: readonly InvWallet[] } = {},
) {
  return { evm: over.evm ?? [], solana: over.solana ?? [] };
}

function setVex(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: {
      onboarding: { getEnvState: getEnvStateMock },
      wallets: { listAvailable: listAvailableMock },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const EVM_ONLY_COPY = /EVM\/Polygon-only — Solana wallets are not supported/i;

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error — test cleanup
  delete window.vex;
});

describe("SettingsPanel", () => {
  it("shows a loading state until env state AND inventory resolve", () => {
    getEnvStateMock.mockReturnValue(new Promise(() => {}));
    listAvailableMock.mockReturnValue(new Promise(() => {}));
    setVex();
    render(createElement(SettingsPanel), { wrapper: makeWrapper(freshClient()) });
    expect(screen.getByText(/Loading settings/i)).not.toBeNull();
  });

  it("shows an error when env state fails", async () => {
    getEnvStateMock.mockResolvedValue({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "onboarding",
        message: "env probe boom",
        retryable: true,
        userActionable: false,
        redacted: true,
        correlationId: "c",
      },
    });
    listAvailableMock.mockResolvedValue({ ok: true, data: buildInventory() });
    setVex();
    render(createElement(SettingsPanel), { wrapper: makeWrapper(freshClient()) });
    await waitFor(() =>
      expect(screen.getByText(/env probe boom/i)).not.toBeNull(),
    );
  });

  it("shows Polymarket setup + EVM-only copy when an EVM wallet exists in the inventory", async () => {
    getEnvStateMock.mockResolvedValue({ ok: true, data: buildEnvState() });
    listAvailableMock.mockResolvedValue({
      ok: true,
      data: buildInventory({ evm: [evmWallet("0xaaa")] }),
    });
    setVex();
    render(createElement(SettingsPanel), { wrapper: makeWrapper(freshClient()) });
    await waitFor(() =>
      expect(screen.getByTestId("polymarket-auto-setup")).not.toBeNull(),
    );
    expect(screen.getByText(EVM_ONLY_COPY)).not.toBeNull();
  });

  it("shows the add-an-EVM-wallet hint when the inventory has no EVM wallet", async () => {
    getEnvStateMock.mockResolvedValue({ ok: true, data: buildEnvState() });
    listAvailableMock.mockResolvedValue({ ok: true, data: buildInventory({ evm: [] }) });
    setVex();
    const { container } = render(createElement(SettingsPanel), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() =>
      expect(
        container.querySelector('[data-vex-settings-polymarket="no-evm"]'),
      ).not.toBeNull(),
    );
    expect(screen.queryByTestId("polymarket-auto-setup")).toBeNull();
    expect(screen.getByText(EVM_ONLY_COPY)).not.toBeNull();
  });

  it("uses the inventory (not legacy walletAddresses) for the primary — renders the configured path", async () => {
    // env reports the wallet present but walletAddresses is NULL (real
    // multi-wallet model); the inventory carries the primary. SettingsPanel
    // must pass the inventory address to ChainActions, NOT null.
    getEnvStateMock.mockResolvedValue({ ok: true, data: buildEnvState() });
    listAvailableMock.mockResolvedValue({
      ok: true,
      data: buildInventory({ evm: [evmWallet("0xPRIMARY")] }),
    });
    setVex();
    render(createElement(SettingsPanel), { wrapper: makeWrapper(freshClient()) });
    await waitFor(() => {
      const el = screen.getByTestId("chain-actions-evm");
      expect(el.getAttribute("data-address")).toBe("0xPRIMARY");
    });
  });

  it("Back returns to the chat view; Re-run setup wizard opens reconfigure", async () => {
    getEnvStateMock.mockResolvedValue({ ok: true, data: buildEnvState() });
    listAvailableMock.mockResolvedValue({
      ok: true,
      data: buildInventory({ evm: [evmWallet("0xaaa")] }),
    });
    setVex();
    render(createElement(SettingsPanel), { wrapper: makeWrapper(freshClient()) });

    fireEvent.click(screen.getByRole("button", { name: /Back to chat/i }));
    expect(mockSetAppShellView).toHaveBeenCalledWith("session");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Re-run setup wizard/i }),
      ).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Re-run setup wizard/i }));
    expect(mockOpenWizard).toHaveBeenCalledWith("reconfigure");
  });
});
