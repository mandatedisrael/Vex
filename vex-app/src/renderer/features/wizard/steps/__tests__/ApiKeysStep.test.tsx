/**
 * ApiKeysStep tests (M9 Step 3).
 *
 * Verifies:
 *  - Skip-card when JUPITER configured + polymarket NOT partial.
 *  - "Repair Polymarket" warning rendered when polymarketStatus === "partial".
 *  - Form rejects partial Polymarket trio at the renderer level.
 *  - Successful submit clears all input refs synchronously and advances.
 *  - "Skip optional" advances without calling setApiKeys.
 *  - CHAINSCAN field NOT rendered.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { JSX } from "react";
import type { Result } from "@shared/ipc/result.js";
import type { EnvState } from "@shared/schemas/onboarding.js";
import type { ApiKeysSetInput, ApiKeysSetResult } from "@shared/schemas/api-keys.js";
import type {
  SetWizardStateInput,
  WizardState,
} from "@shared/schemas/wizard.js";

const mockUseEnvState = vi.fn();
const mockSetApiKeys = vi.fn();
const mockSetWizardMutate = vi.fn();
const mockInvalidate = vi.fn();
const mockOnAdvance = vi.fn();

vi.mock("../../../../lib/api/onboarding.js", () => ({
  useEnvState: () => mockUseEnvState(),
}));

vi.mock("../../../../lib/api/api-keys.js", () => ({
  setApiKeys: (input: ApiKeysSetInput) => mockSetApiKeys(input),
  useInvalidateEnvStateAfterApiKeysWrite: () => mockInvalidate,
}));

vi.mock("../../../../lib/api/wizard.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../lib/api/wizard.js")>(
      "../../../../lib/api/wizard.js",
    );
  return {
    ...actual,
    useSetWizardState: () =>
      ({
        mutateAsync: (input: SetWizardStateInput) => mockSetWizardMutate(input),
        isPending: false,
      }) as unknown as UseMutationResult<
        Result<WizardState>,
        Error,
        SetWizardStateInput
      >,
  };
});

const { ApiKeysStep } = await import("../ApiKeysStep.js");

function envState(overrides: Partial<EnvState["apiKeys"]> = {}): EnvState {
  return {
    hasKeystorePassword: true,
    hasJupiterApiKey: overrides.jupiterConfigured ?? false,
    apiKeys: {
      jupiterConfigured: false,
      tavilyConfigured: false,
      rettiwtConfigured: false,
      polymarketStatus: "missing",
      ...overrides,
    },
    embeddings: {
      configured: false,
      reachable: false,
      baseUrlRedacted: null,
      allFieldsConfigured: false,
      dbReachable: null,
    },
    walletStatus: { evm: "present", solana: "present" },
    setupCompleteFlag: false,
  };
}

function makeQueryResult(state: EnvState | undefined): UseQueryResult<Result<EnvState>> {
  return {
    data: state ? { ok: true, data: state } : undefined,
    isLoading: state === undefined,
    isError: false,
    isSuccess: state !== undefined,
  } as UseQueryResult<Result<EnvState>>;
}

function renderWithQuery(ui: JSX.Element) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockUseEnvState.mockReset();
  mockSetApiKeys.mockReset();
  mockSetWizardMutate.mockReset();
  mockInvalidate.mockReset();
  mockOnAdvance.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ApiKeysStep", () => {
  it("renders skip-card when JUPITER configured + polymarket not partial", () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState({ jupiterConfigured: true })));
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    expect(container.querySelector('[data-vex-wizard-apikeys="skip"]')).not.toBeNull();
    expect(container.querySelector('[data-vex-wizard-apikeys="form"]')).toBeNull();
  });

  it("shows the form even when JUPITER is set if polymarket is partial", () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({ jupiterConfigured: true, polymarketStatus: "partial" })),
    );
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    expect(container.querySelector('[data-vex-wizard-apikeys="form"]')).not.toBeNull();
    expect(container.querySelector('[data-vex-apikeys-warning="polymarket-partial"]')).not.toBeNull();
  });

  it("rejects partial polymarket trio at the renderer (does NOT call setApiKeys)", async () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container, getByLabelText, getByText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    fireEvent.input(getByLabelText("API key"), { target: { value: "k" } });
    // Leave secret + passphrase empty
    const form = container.querySelector('[data-vex-wizard-apikeys="form"] form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(getByText(/needs all three fields/i)).toBeTruthy();
    });
    expect(mockSetApiKeys).not.toHaveBeenCalled();
  });

  it("submits Jupiter key, clears the input, and advances on success", async () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    mockSetApiKeys.mockResolvedValue({
      ok: true,
      data: { fieldsWritten: ["JUPITER_API_KEY"] },
    } as Result<ApiKeysSetResult>);
    mockSetWizardMutate.mockResolvedValue({
      ok: true,
      data: {
        schemaVersion: 1,
        currentStepId: "embedding",
        completedSteps: ["keystore", "wallets", "apiKeys"],
        completed: false,
      },
    } as Result<WizardState>);
    const { container, getByLabelText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    const jupiterInput = getByLabelText(/Jupiter API key/i) as HTMLInputElement;
    fireEvent.input(jupiterInput, { target: { value: "sk-jupiter-secret" } });
    const form = container.querySelector('[data-vex-wizard-apikeys="form"] form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(mockSetApiKeys).toHaveBeenCalledWith({ jupiterApiKey: "sk-jupiter-secret" });
    });
    // Input value cleared synchronously before await — should be empty by now.
    expect(jupiterInput.value).toBe("");
    await waitFor(() => {
      expect(mockOnAdvance).toHaveBeenCalledWith("embedding");
    });
  });

  it("'Skip optional' BLOCKS when Jupiter not configured (codex DRIFT)", async () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { getByText, findByText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    fireEvent.click(getByText("Skip optional"));
    await findByText(/Jupiter API key is required/i);
    expect(mockOnAdvance).not.toHaveBeenCalled();
    expect(mockSetWizardMutate).not.toHaveBeenCalled();
  });

  it("'Skip optional' BLOCKS when Polymarket is partial (codex DRIFT)", async () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({ jupiterConfigured: true, polymarketStatus: "partial" })),
    );
    const { getByText, findByText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    fireEvent.click(getByText("Skip optional"));
    await findByText(/Polymarket has only some credentials saved/i);
    expect(mockOnAdvance).not.toHaveBeenCalled();
  });

  it("'Skip optional' advances when Jupiter configured + polymarket not partial", async () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({ jupiterConfigured: true, polymarketStatus: "configured" })),
    );
    mockSetWizardMutate.mockResolvedValue({
      ok: true,
      data: {
        schemaVersion: 1,
        currentStepId: "embedding",
        completedSteps: ["keystore", "wallets", "apiKeys"],
        completed: false,
      },
    } as Result<WizardState>);
    const { getByText, container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    // Already configured → skip-card path; should still expose a Continue button.
    expect(container.querySelector('[data-vex-wizard-apikeys="skip"]')).not.toBeNull();
    fireEvent.click(getByText("Continue"));
    await waitFor(() => {
      expect(mockOnAdvance).toHaveBeenCalledWith("embedding");
    });
    expect(mockSetApiKeys).not.toHaveBeenCalled();
  });

  it("'Save and continue' empty submit BLOCKS when Jupiter not configured (codex DRIFT turn 9)", async () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container, findByText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    const form = container.querySelector('[data-vex-wizard-apikeys="form"] form')!;
    fireEvent.submit(form);
    await findByText(/Jupiter API key is required/i);
    expect(mockSetApiKeys).not.toHaveBeenCalled();
    expect(mockOnAdvance).not.toHaveBeenCalled();
  });

  it("'Save and continue' BLOCKS when Polymarket partial + trio not supplied", async () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({ jupiterConfigured: true, polymarketStatus: "partial" })),
    );
    const { container, findByText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    const form = container.querySelector('[data-vex-wizard-apikeys="form"] form')!;
    fireEvent.submit(form);
    await findByText(/Polymarket has only some credentials saved/i);
    expect(mockSetApiKeys).not.toHaveBeenCalled();
  });

  it("does NOT render a CHAINSCAN field anywhere in the form", () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} />,
    );
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain("chainscan");
  });
});
