/**
 * WizardShell — verifies routing between steps based on persisted
 * wizard-state.json, the skip-to-app flip when `completed === true`,
 * and the error/loading shells. Mocks `window.vex` per skill §12 and
 * the API hooks layer so we never touch a real IPC bridge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { JSX } from "react";
import type { Result } from "@shared/ipc/result.js";
import type { WizardState } from "@shared/schemas/wizard.js";

const mockUseWizardState = vi.fn();
const mockSetCurrentView = vi.fn();

vi.mock("../../../lib/api/wizard.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../../lib/api/wizard.js")>(
      "../../../lib/api/wizard.js"
    );
  return {
    ...actual,
    useWizardState: () => mockUseWizardState(),
  };
});

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (selector: (s: { setCurrentView: typeof mockSetCurrentView }) => unknown) =>
    selector({ setCurrentView: mockSetCurrentView }),
}));

vi.mock("../steps/KeystoreStep.js", () => ({
  KeystoreStep: () => <div data-testid="keystore-step" />,
}));

vi.mock("../steps/WalletsStep.js", () => ({
  WalletsStep: () => <div data-testid="wallets-step" />,
}));

vi.mock("../steps/ApiKeysStep.js", () => ({
  ApiKeysStep: () => <div data-testid="apikeys-step" />,
}));

vi.mock("../steps/EmbeddingStep.js", () => ({
  EmbeddingStep: () => <div data-testid="embedding-step" />,
}));

vi.mock("../steps/AgentCoreStep.js", () => ({
  AgentCoreStep: () => <div data-testid="agentcore-step" />,
}));

vi.mock("../steps/PlaceholderStep.js", () => ({
  PlaceholderStep: ({ stepId, milestone }: { stepId: string; milestone: string }) => (
    <div data-testid="placeholder-step" data-step={stepId} data-milestone={milestone} />
  ),
}));

const { WizardShell } = await import("../WizardShell.js");

function renderWithQuery(ui: JSX.Element) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function makeQueryResult(
  data: Result<WizardState> | undefined,
  overrides: Partial<UseQueryResult<Result<WizardState>>> = {}
): UseQueryResult<Result<WizardState>> {
  return {
    data,
    isLoading: data === undefined,
    isError: false,
    isSuccess: data !== undefined,
    ...overrides,
  } as UseQueryResult<Result<WizardState>>;
}

beforeEach(() => {
  mockUseWizardState.mockReset();
  mockSetCurrentView.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("WizardShell", () => {
  it("renders the loading shell while the wizardState query is pending", () => {
    mockUseWizardState.mockReturnValue(makeQueryResult(undefined));
    const { container, queryByTestId } = renderWithQuery(<WizardShell />);
    expect(queryByTestId("keystore-step")).toBeNull();
    expect(queryByTestId("placeholder-step")).toBeNull();
    // The screen container is still rendered; the shell shows a pulse.
    expect(container.querySelector('[data-vex-screen="wizard"]')).not.toBeNull();
  });

  it("renders KeystoreStep when persisted.currentStepId === 'keystore'", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 1,
          currentStepId: "keystore",
          completedSteps: [],
          completed: false,
        },
      })
    );
    const { findByTestId } = renderWithQuery(<WizardShell />);
    await findByTestId("keystore-step");
  });

  it("renders WalletsStep when persisted.currentStepId === 'wallets' (M8)", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 1,
          currentStepId: "wallets",
          completedSteps: ["keystore"],
          completed: false,
        },
      })
    );
    const { findByTestId } = renderWithQuery(<WizardShell />);
    await findByTestId("wallets-step");
  });

  it("renders ApiKeysStep when persisted.currentStepId === 'apiKeys' (M9)", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 1,
          currentStepId: "apiKeys",
          completedSteps: ["keystore", "wallets"],
          completed: false,
        },
      })
    );
    const { findByTestId } = renderWithQuery(<WizardShell />);
    await findByTestId("apikeys-step");
  });

  it("renders EmbeddingStep when persisted.currentStepId === 'embedding' (M9)", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 1,
          currentStepId: "embedding",
          completedSteps: ["keystore", "wallets", "apiKeys"],
          completed: false,
        },
      })
    );
    const { findByTestId } = renderWithQuery(<WizardShell />);
    await findByTestId("embedding-step");
  });

  it("renders AgentCoreStep when persisted.currentStepId === 'agentCore' (M9)", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 1,
          currentStepId: "agentCore",
          completedSteps: ["keystore", "wallets", "apiKeys", "embedding"],
          completed: false,
        },
      })
    );
    const { findByTestId } = renderWithQuery(<WizardShell />);
    await findByTestId("agentcore-step");
  });

  it("renders PlaceholderStep with M10 milestone for the provider step (still placeholder)", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 1,
          currentStepId: "provider",
          completedSteps: ["keystore", "wallets", "apiKeys", "embedding", "agentCore"],
          completed: false,
        },
      })
    );
    const { findByTestId } = renderWithQuery(<WizardShell />);
    const node = await findByTestId("placeholder-step");
    expect(node.getAttribute("data-step")).toBe("provider");
    expect(node.getAttribute("data-milestone")).toBe("M10");
  });

  it("flips view to placeholder when persisted.completed === true", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 1,
          currentStepId: "review",
          completedSteps: [
            "keystore",
            "wallets",
            "apiKeys",
            "embedding",
            "agentCore",
            "provider",
            "mode",
            "wake",
          ],
          completed: true,
        },
      })
    );
    renderWithQuery(<WizardShell />);
    await waitFor(() => {
      expect(mockSetCurrentView).toHaveBeenCalledWith("placeholder");
    });
  });

  it("renders the error shell when the query returns ok:false", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult(
        {
          ok: false,
          error: {
            code: "internal.contract_violation",
            domain: "onboarding",
            message: "boom",
            retryable: false,
            userActionable: false,
            redacted: true,
          },
        },
        { isSuccess: true }
      )
    );
    const { findByText, queryByTestId } = renderWithQuery(<WizardShell />);
    await findByText(/Setup unavailable/);
    expect(queryByTestId("keystore-step")).toBeNull();
    expect(queryByTestId("placeholder-step")).toBeNull();
  });
});
