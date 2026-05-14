/**
 * Wizard Step 3 — API keys (M9 + feature #7 Polymarket auto-setup).
 *
 * Stores optional API keys + the all-or-none Polymarket trio via
 * `vex.onboarding.apiKeysSet`. Per skill §14: secret inputs are
 * uncontrolled DOM refs, plain-async submit, refs cleared
 * synchronously after firing the IPC. Per-field "Set ✓ / Not set"
 * derives from envState booleans only — values never round-trip.
 *
 * Skip-card semantics (codex turn 1 D3 + feature #7 Q5):
 *   - Step 3 is "configured" iff JUPITER_API_KEY is set AND the
 *     Polymarket status is NOT "partial". Partial blocks the skip
 *     and surfaces a "Repair Polymarket" CTA in the form.
 *   - Skip-card is ONLY shown in `first-pass` flow mode. In
 *     `back-edit` mode (user clicked Edit from Review) we always
 *     render the full form so they can change anything.
 *   - In setup mode the skip-card surfaces a "Configure Polymarket
 *     now" CTA when polymarketStatus !== "configured" so the operator
 *     can run feature #7 auto-setup without going through Settings.
 *
 * Polymarket trio: schema enforces all-or-none. Renderer only emits
 * the trio when the user types at least one of the three; if any
 * one is filled, the form requires all three before submit. Feature
 * #7 adds a derived auto-setup path that runs above the manual trio.
 */

import { useCallback, useRef, useState, type JSX } from "react";
import {
  type ApiKeysSetInput,
  validatePolymarketManualTrio,
} from "@shared/schemas/api-keys.js";
import {
  type WizardStepId,
} from "@shared/schemas/wizard.js";
import { Button } from "../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";
import { Label } from "../../../components/ui/label.js";
import { PasswordField } from "../../../components/common/PasswordField.js";
import { useEnvState } from "../../../lib/api/onboarding.js";
import {
  setApiKeys,
  useInvalidateEnvStateAfterApiKeysWrite,
} from "../../../lib/api/api-keys.js";
import {
  useStepAdvance,
  type WizardFlowMode,
} from "../../../lib/api/wizard.js";
import { PolymarketFieldset } from "./polymarket-auto-setup/PolymarketFieldset.js";

export interface ApiKeysStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
  readonly flowMode: WizardFlowMode;
}

interface FieldRefs {
  readonly jupiter: React.RefObject<HTMLInputElement | null>;
  readonly tavily: React.RefObject<HTMLInputElement | null>;
  readonly rettiwt: React.RefObject<HTMLInputElement | null>;
  readonly polymarketKey: React.RefObject<HTMLInputElement | null>;
  readonly polymarketSecret: React.RefObject<HTMLInputElement | null>;
  readonly polymarketPassphrase: React.RefObject<HTMLInputElement | null>;
}

function clearAll(refs: FieldRefs): void {
  for (const ref of Object.values(refs)) {
    if (ref.current) ref.current.value = "";
  }
}

function buildPayload(refs: FieldRefs): ApiKeysSetInput | { error: string } {
  const jupiter = refs.jupiter.current?.value.trim() ?? "";
  const tavily = refs.tavily.current?.value.trim() ?? "";
  const rettiwt = refs.rettiwt.current?.value.trim() ?? "";
  const pmKey = refs.polymarketKey.current?.value.trim() ?? "";
  const pmSecret = refs.polymarketSecret.current?.value.trim() ?? "";
  const pmPass = refs.polymarketPassphrase.current?.value.trim() ?? "";

  const trio = validatePolymarketManualTrio({
    apiKey: pmKey,
    apiSecret: pmSecret,
    passphrase: pmPass,
  });
  if (trio.kind === "partial") {
    return {
      error:
        "Polymarket needs all three fields (API key, secret, passphrase) — or leave them all blank.",
    };
  }

  const input: ApiKeysSetInput = {
    ...(jupiter.length > 0 ? { jupiterApiKey: jupiter } : {}),
    ...(tavily.length > 0 ? { tavilyApiKey: tavily } : {}),
    ...(rettiwt.length > 0 ? { rettiwtApiKey: rettiwt } : {}),
    ...(trio.kind === "complete"
      ? {
          polymarket: {
            apiKey: pmKey,
            apiSecret: pmSecret,
            passphrase: pmPass,
          },
        }
      : {}),
  };
  return input;
}

export function ApiKeysStep({
  completedSteps,
  onAdvance,
  flowMode,
}: ApiKeysStepProps): JSX.Element {
  const envQuery = useEnvState();
  const stepAdvance = useStepAdvance();
  const invalidateEnvState = useInvalidateEnvStateAfterApiKeysWrite();

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submittedOnce, setSubmittedOnce] = useState(false);
  // Feature #7 Q5: in setup mode, skip-card can be "opened" to reveal
  // the full form (so the operator can run auto-setup without first
  // visiting Settings). The flag stays local — refetching envState
  // does not reset it.
  const [skipExpanded, setSkipExpanded] = useState(false);

  const refs: FieldRefs = {
    jupiter: useRef<HTMLInputElement | null>(null),
    tavily: useRef<HTMLInputElement | null>(null),
    rettiwt: useRef<HTMLInputElement | null>(null),
    polymarketKey: useRef<HTMLInputElement | null>(null),
    polymarketSecret: useRef<HTMLInputElement | null>(null),
    polymarketPassphrase: useRef<HTMLInputElement | null>(null),
  };

  const envState = envQuery.data?.ok === true ? envQuery.data.data : null;
  const apiKeysState = envState?.apiKeys ?? null;
  const jupiterConfigured = apiKeysState?.jupiterConfigured ?? false;
  const polymarketStatus = apiKeysState?.polymarketStatus ?? "missing";
  const polymarketPartial = polymarketStatus === "partial";
  // Feature #7 inputs: the auto-setup IPC needs an EVM keystore and an
  // unlocked vault. Both come from envState; the section disables its
  // button (with helper text) when either is missing.
  const evmWalletPresent = envState?.walletStatus.evm === "present";
  const vaultUnlocked = envState?.secrets.unlocked ?? false;
  // Feature #7 Q5: back-edit ALWAYS renders the full form. In setup
  // mode the skip-card stays available unless the operator clicked the
  // "Configure Polymarket now" CTA (skipExpanded === true).
  const canSkip =
    flowMode === "first-pass"
    && jupiterConfigured
    && !polymarketPartial
    && !submittedOnce
    && !skipExpanded;

  const advanceToEmbedding = useCallback(async () => {
    const result = await stepAdvance.advance({
      flowMode,
      completedSteps,
      current: "apiKeys",
      forwardNext: "embedding",
      onAdvance,
    });
    if (!result.ok) setFormError(result.message);
  }, [stepAdvance, flowMode, completedSteps, onAdvance]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setFormError(null);
      const built = buildPayload(refs);
      if ("error" in built) {
        setFormError(built.error);
        return;
      }
      // Same required-state guards as the Skip button (codex DRIFT
      // turn 9): empty Save when Jupiter is not yet configured must
      // not advance; partial Polymarket in env requires either a full
      // trio submission OR a repair-before-skip path.
      if (!jupiterConfigured && built.jupiterApiKey === undefined) {
        setFormError(
          "Jupiter API key is required for Solana trading. Enter it before continuing.",
        );
        return;
      }
      if (polymarketPartial && built.polymarket === undefined) {
        setFormError(
          "Polymarket has only some credentials saved — enter all three to repair, or clear them later via Settings.",
        );
        return;
      }
      // Snapshot the payload, clear the inputs SYNCHRONOUSLY before
      // the await, then fire IPC. Matches M8 wallet-import contract.
      clearAll(refs);
      setSubmitting(true);
      try {
        const result = await setApiKeys(built);
        if (!result.ok) {
          setFormError(result.error.message);
          return;
        }
        invalidateEnvState();
        setSubmittedOnce(true);
        await advanceToEmbedding();
      } finally {
        setSubmitting(false);
      }
    },
    [
      advanceToEmbedding,
      invalidateEnvState,
      refs,
      jupiterConfigured,
      polymarketPartial,
    ],
  );

  const onSkipContinue = useCallback(async () => {
    setFormError(null);
    if (!jupiterConfigured && !submittedOnce) {
      setFormError(
        "Jupiter API key is required for Solana trading. Enter it before skipping the optional ones.",
      );
      return;
    }
    if (polymarketPartial) {
      setFormError(
        "Polymarket has only some credentials saved — repair (enter all 3) or clear via Settings before skipping.",
      );
      return;
    }
    await advanceToEmbedding();
  }, [advanceToEmbedding, jupiterConfigured, polymarketPartial, submittedOnce]);

  if (canSkip) {
    const polymarketNotConfigured = polymarketStatus !== "configured";
    return (
      <Card className="w-full max-w-2xl" data-vex-wizard-apikeys="skip">
        <CardHeader>
          <CardTitle>API keys already configured</CardTitle>
          <CardDescription>
            Vex found your JUPITER_API_KEY in this install. Continue to
            keep using it. To rotate or add optional integrations
            (Tavily, Rettiwt, Polymarket), use the future Settings panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {formError ? (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
          {polymarketNotConfigured ? (
            <p
              className="mb-4 text-sm text-muted-foreground"
              data-vex-apikeys-skip-polymarket-cta="container"
            >
              Want to enable Polymarket trading?{" "}
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setSkipExpanded(true);
                }}
                className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-vex-apikeys-skip-polymarket-cta="button"
              >
                Configure Polymarket now
              </button>
              .
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                void onSkipContinue();
              }}
              disabled={stepAdvance.isPending}
            >
              {stepAdvance.isPending ? "Continuing…" : "Continue"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl" data-vex-wizard-apikeys="form">
      <CardHeader>
        <CardTitle>Connect your API keys</CardTitle>
        <CardDescription>
          Jupiter is required for Solana trading. The optional keys
          (Tavily, Rettiwt, Polymarket) unlock specific tools later.
          Keys are stored on this machine in your local config and
          sent only to the matching provider when you invoke a tool
          that needs them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {polymarketPartial ? (
          <div
            role="alert"
            data-vex-apikeys-warning="polymarket-partial"
            className="mb-5 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200"
          >
            <strong className="font-semibold">Polymarket needs all three credentials.</strong>{" "}
            One or two are saved already. Re-enter all three (API key,
            secret, passphrase) to repair, or skip and configure later.
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="vex-apikey-jupiter">
              Jupiter API key <span className="text-xs text-muted-foreground">(required)</span>
            </Label>
            <PasswordField
              id="vex-apikey-jupiter"
              autoFocus
              autoComplete="new-password"
              ref={refs.jupiter}
            />
            <p className="text-xs text-muted-foreground">
              {jupiterConfigured
                ? "Set ✓ — leave blank to keep, or paste a new key to overwrite."
                : "Required for Solana swap + portfolio tools."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="vex-apikey-tavily">
              Tavily API key <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <PasswordField
              id="vex-apikey-tavily"
              autoComplete="new-password"
              ref={refs.tavily}
            />
            <p className="text-xs text-muted-foreground">
              {apiKeysState?.tavilyConfigured ? "Set ✓" : "Not set"} — unlocks the web research tool.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="vex-apikey-rettiwt">
              Rettiwt API key <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <PasswordField
              id="vex-apikey-rettiwt"
              autoComplete="new-password"
              ref={refs.rettiwt}
            />
            <p className="text-xs text-muted-foreground">
              {apiKeysState?.rettiwtConfigured ? "Set ✓" : "Not set"} — unlocks the X/Twitter account tool. Use a secondary account.
            </p>
          </div>

          <PolymarketFieldset
            refs={{
              polymarketKey: refs.polymarketKey,
              polymarketSecret: refs.polymarketSecret,
              polymarketPassphrase: refs.polymarketPassphrase,
            }}
            polymarketStatus={polymarketStatus}
            evmWalletPresent={evmWalletPresent}
            vaultUnlocked={vaultUnlocked}
            disabled={submitting || stepAdvance.isPending}
            onAutoSetupSuccess={invalidateEnvState}
          />

          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="flex justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                void onSkipContinue();
              }}
              disabled={submitting || stepAdvance.isPending}
            >
              Skip optional
            </Button>
            <Button
              type="submit"
              disabled={submitting || stepAdvance.isPending}
            >
              {submitting || stepAdvance.isPending
                ? "Saving…"
                : flowMode === "back-edit"
                  ? "Save and return to review"
                  : "Save and continue"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
