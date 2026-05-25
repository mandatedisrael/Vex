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
const mockOpenUnlock = vi.fn();
const mockSecretsStatus = vi.fn();
const mockReviewStep = vi.fn();
let mockWizardEntryMode: "setup" | "reconfigure" = "setup";

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
  useUiStore: (
    selector: (s: {
      setCurrentView: typeof mockSetCurrentView;
      openUnlock: typeof mockOpenUnlock;
      wizardEntryMode: "setup" | "reconfigure";
    }) => unknown
  ) =>
    selector({
      setCurrentView: mockSetCurrentView,
      openUnlock: mockOpenUnlock,
      wizardEntryMode: mockWizardEntryMode,
    }),
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

vi.mock("../steps/review/ReviewStep.js", () => ({
  ReviewStep: (props: unknown) => {
    mockReviewStep(props);
    return <div data-testid="review-step" />;
  },
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
  mockOpenUnlock.mockReset();
  mockSecretsStatus.mockReset();
  mockSecretsStatus.mockResolvedValue({
    ok: true,
    data: { vaultConfigured: true, unlocked: true },
  });
  mockReviewStep.mockReset();
  mockWizardEntryMode = "setup";
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: {
      secrets: {
        status: mockSecretsStatus,
      },
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "vex");
});

describe("WizardShell", () => {
  it("renders the loading shell while the wizardState query is pending", () => {
    mockUseWizardState.mockReturnValue(makeQueryResult(undefined));
    const { container, queryByTestId } = renderWithQuery(<WizardShell />);
    expect(queryByTestId("keystore-step")).toBeNull();
    expect(queryByTestId("review-step")).toBeNull();
    // The screen container is still rendered; the shell shows a pulse.
    expect(container.querySelector('[data-vex-screen="wizard"]')).not.toBeNull();
  });

  it("renders KeystoreStep when persisted.currentStepId === 'keystore'", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 2,
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
          schemaVersion: 2,
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
          schemaVersion: 2,
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
          schemaVersion: 2,
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
          schemaVersion: 2,
          currentStepId: "agentCore",
          completedSteps: ["keystore", "wallets", "apiKeys", "embedding"],
          completed: false,
        },
      })
    );
    const { findByTestId } = renderWithQuery(<WizardShell />);
    await findByTestId("agentcore-step");
  });

  it("renders ReviewStep when persisted.currentStepId === 'review'", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 2,
          currentStepId: "review",
          completedSteps: [
            "keystore",
            "wallets",
            "apiKeys",
            "embedding",
            "agentCore",
            "provider",
          ],
          completed: false,
        },
      })
    );
    const { findByTestId } = renderWithQuery(<WizardShell />);
    await findByTestId("review-step");
  });

  it("renders ProviderStep when persisted.currentStepId === 'provider' (M10)", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 2,
          currentStepId: "provider",
          completedSteps: ["keystore", "wallets", "apiKeys", "embedding", "agentCore"],
          completed: false,
        },
      })
    );
    const { container } = renderWithQuery(<WizardShell />);
    await new Promise((r) => setTimeout(r, 0));
    expect(
      container.querySelector('[data-vex-wizard-provider="form"]') ??
        container.querySelector('[data-vex-wizard-provider="skip"]'),
    ).not.toBeNull();
  });

  it("flips view to appShell when persisted.completed === true", async () => {
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 2,
          currentStepId: "review",
          completedSteps: [
            "keystore",
            "wallets",
            "apiKeys",
            "embedding",
            "agentCore",
            "provider",
          ],
          completed: true,
        },
      })
    );
    renderWithQuery(<WizardShell />);
    await waitFor(() => {
      expect(mockSetCurrentView).toHaveBeenCalledWith("appShell");
    });
  });

  it("opens unlock before appShell when a completed setup has a locked vault", async () => {
    mockSecretsStatus.mockResolvedValue({
      ok: true,
      data: { vaultConfigured: true, unlocked: false },
    });
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 2,
          currentStepId: "review",
          completedSteps: [
            "keystore",
            "wallets",
            "apiKeys",
            "embedding",
            "agentCore",
            "provider",
          ],
          completed: true,
        },
      })
    );
    renderWithQuery(<WizardShell />);
    await waitFor(() => {
      expect(mockOpenUnlock).toHaveBeenCalledWith("appShell");
    });
    expect(mockSetCurrentView).not.toHaveBeenCalledWith("appShell");
  });

  it("opens unlock before resuming an incomplete wizard after keystore", async () => {
    mockSecretsStatus.mockResolvedValue({
      ok: true,
      data: { vaultConfigured: true, unlocked: false },
    });
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 2,
          currentStepId: "wallets",
          completedSteps: ["keystore"],
          completed: false,
        },
      })
    );
    renderWithQuery(<WizardShell />);
    await waitFor(() => {
      expect(mockOpenUnlock).toHaveBeenCalledWith("wizard");
    });
  });

  it("opens ReviewStep in reconfigure mode when completed wizard is explicitly re-entered", async () => {
    mockWizardEntryMode = "reconfigure";
    mockUseWizardState.mockReturnValue(
      makeQueryResult({
        ok: true,
        data: {
          schemaVersion: 2,
          currentStepId: "review",
          completedSteps: [
            "keystore",
            "wallets",
            "apiKeys",
            "embedding",
            "agentCore",
            "provider",
          ],
          completed: true,
        },
      })
    );
    const { findByTestId } = renderWithQuery(<WizardShell />);
    await findByTestId("review-step");
    expect(mockSetCurrentView).not.toHaveBeenCalledWith("appShell");
    expect(mockReviewStep).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "reconfigure" })
    );
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
    expect(queryByTestId("review-step")).toBeNull();
  });
});
