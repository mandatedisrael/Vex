/**
 * ExportWalletPicker — lets the operator choose WHICH wallet in a family to
 * export. Mocks `useAvailableWallets` (config-backed inventory) so the picker's
 * selection logic is tested in isolation: default-to-primary, change reporting,
 * stale-selection self-heal, and the loading / error / empty states. The
 * address shown is display-only; main re-resolves the reported `walletId`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Result } from "@shared/ipc/result.js";
import type { AvailableWalletsDto } from "@shared/schemas/wallets.js";

const mockUseAvailableWallets = vi.fn();
vi.mock("../../../lib/api/wallet-inventory.js", () => ({
  useAvailableWallets: () => mockUseAvailableWallets(),
}));

const { ExportWalletPicker } = await import("../ExportWalletPicker.js");

const EVM_A = {
  id: "evm_a",
  family: "evm" as const,
  address: "0xAAAA000000000000000000000000000000000000",
  label: "EVM A",
};
const EVM_B = {
  id: "evm_b",
  family: "evm" as const,
  address: "0xBBBB000000000000000000000000000000000000",
  label: "EVM B",
};
const SOL_A = {
  id: "sol_a",
  family: "solana" as const,
  address: "SoLAddrAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  label: "SOL A",
};

function ok(
  dto: AvailableWalletsDto,
): { isLoading: false; data: Result<AvailableWalletsDto> } {
  return { isLoading: false, data: { ok: true, data: dto } };
}

function selectEl(container: HTMLElement): HTMLSelectElement {
  const el = container.querySelector("[data-vex-export-wallet-select]");
  if (el === null) throw new Error("wallet select not rendered");
  return el as HTMLSelectElement;
}

beforeEach(() => {
  mockUseAvailableWallets.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ExportWalletPicker", () => {
  it("lists only the chain's wallets and defaults the selection to the primary", () => {
    mockUseAvailableWallets.mockReturnValue(
      ok({ evm: [EVM_A, EVM_B], solana: [SOL_A] }),
    );
    const onSelect = vi.fn();
    const { container } = render(
      <ExportWalletPicker chain="evm" onSelect={onSelect} />,
    );

    const options = selectEl(container).querySelectorAll("option");
    expect(options).toHaveLength(2);
    expect(Array.from(options).map((o) => o.value)).toEqual(["evm_a", "evm_b"]);
    // Primary (index 0) is reported up immediately.
    expect(onSelect).toHaveBeenLastCalledWith({
      walletId: "evm_a",
      address: EVM_A.address,
    });
  });

  it("reports the newly chosen wallet on change", () => {
    mockUseAvailableWallets.mockReturnValue(ok({ evm: [EVM_A, EVM_B], solana: [] }));
    const onSelect = vi.fn();
    const { container } = render(
      <ExportWalletPicker chain="evm" onSelect={onSelect} />,
    );

    fireEvent.change(selectEl(container), { target: { value: "evm_b" } });
    expect(onSelect).toHaveBeenLastCalledWith({
      walletId: "evm_b",
      address: EVM_B.address,
    });
  });

  it("reports null and shows a message when the chain has no wallets", () => {
    mockUseAvailableWallets.mockReturnValue(ok({ evm: [], solana: [] }));
    const onSelect = vi.fn();
    const { container } = render(
      <ExportWalletPicker chain="solana" onSelect={onSelect} />,
    );

    expect(container.textContent).toMatch(/No Solana wallet/i);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("shows a loading state and reports no selection", () => {
    mockUseAvailableWallets.mockReturnValue({ isLoading: true, data: undefined });
    const onSelect = vi.fn();
    const { container } = render(
      <ExportWalletPicker chain="evm" onSelect={onSelect} />,
    );

    expect(container.textContent).toMatch(/Loading wallets/i);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("shows an error state when the inventory query failed", () => {
    mockUseAvailableWallets.mockReturnValue({
      isLoading: false,
      data: {
        ok: false,
        error: {
          code: "internal.unexpected",
          domain: "wallets",
          message: "boom",
          retryable: true,
          userActionable: false,
          redacted: true,
        },
      },
    });
    const onSelect = vi.fn();
    const { container } = render(
      <ExportWalletPicker chain="evm" onSelect={onSelect} />,
    );

    expect(container.textContent).toMatch(/Couldn.t load your wallets/i);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("self-heals a stale selection when the chosen wallet leaves the inventory", () => {
    mockUseAvailableWallets.mockReturnValue(ok({ evm: [EVM_A, EVM_B], solana: [] }));
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <ExportWalletPicker chain="evm" onSelect={onSelect} />,
    );
    fireEvent.change(selectEl(container), { target: { value: "evm_b" } });
    expect(onSelect).toHaveBeenLastCalledWith({
      walletId: "evm_b",
      address: EVM_B.address,
    });

    // EVM_B disappears from the inventory → selection falls back to primary.
    mockUseAvailableWallets.mockReturnValue(ok({ evm: [EVM_A], solana: [] }));
    rerender(<ExportWalletPicker chain="evm" onSelect={onSelect} />);
    expect(onSelect).toHaveBeenLastCalledWith({
      walletId: "evm_a",
      address: EVM_A.address,
    });
  });
});
