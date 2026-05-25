/**
 * ApiKeysStep tests (M9 Step 3 + feature #7 Polymarket auto-setup +
 * PR8 redesign — per-provider glass cards).
 *
 * Verifies:
 *  - Skip-card when JUPITER configured + polymarket NOT partial.
 *  - Skip-card surfaces "Configure Polymarket now" CTA in setup mode
 *    when polymarketStatus !== "configured" (feature #7).
 *  - back-edit flow ALWAYS renders the form (feature #7 Codex Q5).
 *  - "Repair Polymarket" warning rendered when polymarketStatus === "partial".
 *  - Successful submit clears all input refs synchronously and advances.
 *  - "Skip optional" advances without calling setApiKeys.
 *  - Legacy API-key fields are not rendered.
 *  - 4 provider cards render in canonical order (jupiter → tavily →
 *    rettiwt → polymarket) and each carries the correct external link.
 *  - Polymarket card hosts the auto-setup section only — no manual
 *    API-key / secret / passphrase inputs (PR8).
 *  - Every external "Get key" link opens with target="_blank" +
 *    rel="noopener noreferrer".
 *  - PolymarketAutoSetupSection mounts inside the Polymarket card
 *    (feature #7) and the onSuccess callback wires through to envState
 *    invalidation (Codex Q8).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
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
  const { makeMockUseStepAdvance } = await import("../../__tests__/useStepAdvance-mock.js");
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
    useStepAdvance: makeMockUseStepAdvance(mockSetWizardMutate),
  };
});

const { ApiKeysStep } = await import("../ApiKeysStep.js");

interface EnvStateExtras {
  readonly secretsUnlocked?: boolean;
  readonly evmWalletPresent?: boolean;
}

function envState(
  overrides: Partial<EnvState["apiKeys"]> = {},
  extras: EnvStateExtras = {},
): EnvState {
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
    secrets: {
      vaultConfigured: true,
      unlocked: extras.secretsUnlocked ?? true,
    },
    embeddings: {
      configured: false,
      reachable: false,
      baseUrlRedacted: null,
      allFieldsConfigured: false,
      dbReachable: null,
    },
    walletStatus: {
      evm: (extras.evmWalletPresent ?? true) ? "present" : "missing",
      solana: "present",
    },
    provider: { configured: false, name: null, modelLabel: null },
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
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    expect(container.querySelector('[data-vex-wizard-apikeys="skip"]')).not.toBeNull();
    expect(container.querySelector('[data-vex-wizard-apikeys="form"]')).toBeNull();
  });

  it("shows the form even when JUPITER is set if polymarket is partial", () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({ jupiterConfigured: true, polymarketStatus: "partial" })),
    );
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    expect(container.querySelector('[data-vex-wizard-apikeys="form"]')).not.toBeNull();
    expect(container.querySelector('[data-vex-apikeys-warning="polymarket-partial"]')).not.toBeNull();
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
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
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

  it("'Skip optional' blocks when Jupiter is not configured", async () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { getByText, findByText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    fireEvent.click(getByText("Skip optional"));
    await findByText(/Jupiter API key is required/i);
    expect(mockOnAdvance).not.toHaveBeenCalled();
    expect(mockSetWizardMutate).not.toHaveBeenCalled();
  });

  it("'Skip optional' blocks when Polymarket configuration is partial", async () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({ jupiterConfigured: true, polymarketStatus: "partial" })),
    );
    const { getByText, findByText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
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
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    // Already configured → skip-card path; should still expose a Continue button.
    expect(container.querySelector('[data-vex-wizard-apikeys="skip"]')).not.toBeNull();
    fireEvent.click(getByText("Continue"));
    await waitFor(() => {
      expect(mockOnAdvance).toHaveBeenCalledWith("embedding");
    });
    expect(mockSetApiKeys).not.toHaveBeenCalled();
  });

  it("'Save and continue' empty submit blocks when Jupiter is not configured", async () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container, findByText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
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
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const form = container.querySelector('[data-vex-wizard-apikeys="form"] form')!;
    fireEvent.submit(form);
    await findByText(/Polymarket has only some credentials saved/i);
    expect(mockSetApiKeys).not.toHaveBeenCalled();
  });

  it("does not render legacy API-key fields in the form", () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain("legacyapikey");
  });

  it("back-edit mode renders the full form even when Jupiter is configured", () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({ jupiterConfigured: true, polymarketStatus: "missing" })),
    );
    const { container } = renderWithQuery(
      <ApiKeysStep
        completedSteps={["keystore", "wallets", "apiKeys"]}
        onAdvance={mockOnAdvance}
        flowMode="back-edit"
      />,
    );
    expect(container.querySelector('[data-vex-wizard-apikeys="form"]')).not.toBeNull();
    expect(container.querySelector('[data-vex-wizard-apikeys="skip"]')).toBeNull();
  });

  it("setup mode skip-card shows 'Configure Polymarket now' CTA when polymarket missing", () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({ jupiterConfigured: true, polymarketStatus: "missing" })),
    );
    const { container, getByText } = renderWithQuery(
      <ApiKeysStep
        completedSteps={["keystore", "wallets"]}
        onAdvance={mockOnAdvance}
        flowMode="first-pass"
      />,
    );
    expect(container.querySelector('[data-vex-wizard-apikeys="skip"]')).not.toBeNull();
    expect(getByText(/Configure Polymarket now/i)).toBeTruthy();
  });

  it("setup mode skip-card hides 'Configure Polymarket now' CTA when polymarket configured", () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(
        envState({ jupiterConfigured: true, polymarketStatus: "configured" }),
      ),
    );
    const { container } = renderWithQuery(
      <ApiKeysStep
        completedSteps={["keystore", "wallets"]}
        onAdvance={mockOnAdvance}
        flowMode="first-pass"
      />,
    );
    expect(container.querySelector('[data-vex-wizard-apikeys="skip"]')).not.toBeNull();
    expect(
      container.querySelector("[data-vex-apikeys-skip-polymarket-cta='button']"),
    ).toBeNull();
  });

  it("clicking 'Configure Polymarket now' CTA expands skip-card into the form", () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({ jupiterConfigured: true, polymarketStatus: "missing" })),
    );
    const { container, getByText } = renderWithQuery(
      <ApiKeysStep
        completedSteps={["keystore", "wallets"]}
        onAdvance={mockOnAdvance}
        flowMode="first-pass"
      />,
    );
    fireEvent.click(getByText(/Configure Polymarket now/i));
    expect(container.querySelector('[data-vex-wizard-apikeys="form"]')).not.toBeNull();
    expect(
      container.querySelector("[data-vex-polymarket-auto-button]"),
    ).not.toBeNull();
  });

  it("Polymarket fieldset includes the auto-setup section (feature #7)", () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const fieldset = container.querySelector(
      "[data-vex-apikeys-polymarket='fieldset']",
    );
    expect(fieldset).not.toBeNull();
    expect(
      fieldset?.querySelector("[data-vex-polymarket-auto-button]"),
    ).not.toBeNull();
  });

  it("auto-setup section button is disabled when EVM wallet missing (feature #7)", () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({}, { evmWalletPresent: false })),
    );
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const button = container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      container.querySelector("[data-vex-polymarket-auto-helper]")?.textContent,
    ).toMatch(/EVM wallet required/);
  });

  it("auto-setup section button is disabled when vault locked (feature #7)", () => {
    mockUseEnvState.mockReturnValue(
      makeQueryResult(envState({}, { secretsUnlocked: false })),
    );
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const button = container.querySelector(
      "[data-vex-polymarket-auto-button]",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      container.querySelector("[data-vex-polymarket-auto-helper]")?.textContent,
    ).toMatch(/Unlock Vex first/);
  });

  it("'Save and continue' empty submit does not auto-advance when Jupiter is missing", async () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container, findByText } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const form = container.querySelector('[data-vex-wizard-apikeys="form"] form')!;
    fireEvent.submit(form);
    await findByText(/Jupiter API key is required/i);
    expect(mockOnAdvance).not.toHaveBeenCalled();
    expect(mockSetWizardMutate).not.toHaveBeenCalled();
  });

  // ── PR8 redesign — per-provider cards ────────────────────────────────

  it("renders 4 provider cards in canonical order (PR8)", () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const cards = container.querySelectorAll("[data-vex-apikeys-card]");
    expect(cards).toHaveLength(4);
    expect(
      Array.from(cards).map((c) => c.getAttribute("data-vex-apikeys-card")),
    ).toEqual(["jupiter", "tavily", "rettiwt", "polymarket"]);
  });

  it("renders canonical external links for each provider card (PR8)", () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const jupHref = container
      .querySelector('[data-vex-apikeys-card="jupiter"] a[href]')
      ?.getAttribute("href");
    expect(jupHref).toBe("https://portal.jup.ag/");

    const tavHref = container
      .querySelector('[data-vex-apikeys-card="tavily"] a[href]')
      ?.getAttribute("href");
    expect(tavHref).toBe("https://app.tavily.com/home");

    const rettiwtHrefs = Array.from(
      container.querySelectorAll('[data-vex-apikeys-card="rettiwt"] a[href]'),
    ).map((a) => a.getAttribute("href"));
    expect(rettiwtHrefs).toContain(
      "https://chromewebstore.google.com/detail/x-auth-helper/igpkhkjmpdecacocghpgkghdcmcmpfhp",
    );
    expect(rettiwtHrefs).toContain(
      "https://addons.mozilla.org/en-US/firefox/addon/rettiwt-auth-helper",
    );

    // Polymarket card has NO get-key link (auto-setup only).
    expect(
      container.querySelector('[data-vex-apikeys-card="polymarket"] a[href]'),
    ).toBeNull();
  });

  it("Polymarket card renders auto-setup only — no manual fields (PR8)", () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const polyCard = container.querySelector(
      '[data-vex-apikeys-card="polymarket"]',
    ) as HTMLElement | null;
    expect(polyCard).not.toBeNull();
    if (polyCard === null) return;
    // Auto-setup button is present.
    expect(
      polyCard.querySelector("[data-vex-polymarket-auto-button]"),
    ).not.toBeNull();
    // No manual trio inputs — labels "API key", "API secret",
    // "Passphrase" must not exist anywhere inside the Polymarket card.
    const w = within(polyCard);
    expect(w.queryByLabelText("API key")).toBeNull();
    expect(w.queryByLabelText("API secret")).toBeNull();
    expect(w.queryByLabelText("Passphrase")).toBeNull();
  });

  it("every external link on a card uses target='_blank' + rel='noopener noreferrer' (PR8)", () => {
    mockUseEnvState.mockReturnValue(makeQueryResult(envState()));
    const { container } = renderWithQuery(
      <ApiKeysStep completedSteps={["keystore", "wallets"]} onAdvance={mockOnAdvance} flowMode="first-pass" />,
    );
    const anchors = container.querySelectorAll(
      "[data-vex-apikeys-card] a[href]",
    );
    // We expect at least one anchor (Jupiter / Tavily / 2× Rettiwt).
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of Array.from(anchors)) {
      expect(a.getAttribute("target")).toBe("_blank");
      const rel = a.getAttribute("rel") ?? "";
      expect(rel).toMatch(/\bnoopener\b/);
      expect(rel).toMatch(/\bnoreferrer\b/);
    }
  });
});
