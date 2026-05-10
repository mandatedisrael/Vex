/**
 * Wizard Step 1 — Master password (M7).
 *
 * Persists `VEX_KEYSTORE_PASSWORD` in the shared Vex config via
 * `vex.onboarding.keystoreSet` so vex-shell sees the same value
 * (CLI ↔ GUI parity gate). The form is uncontrolled (React Hook Form
 * `register` ref forwarding) and the inputs are cleared via
 * `form.reset()` after the IPC call succeeds — the password value
 * never lives in long-running React state and never enters Zustand
 * or persistent storage on the renderer side.
 *
 * Skip-badge: when `envState.hasKeystorePassword === true` the form
 * is hidden and a "Already configured ✓" card with a Continue button
 * is shown instead. After a successful keystoreSet we ALSO flip a
 * local `passwordPersisted` flag so the badge appears immediately —
 * the env-state query invalidation is async and may not have refreshed
 * by the time `setWizardState` returns. Without the flag a write that
 * succeeds for the password but fails for the wizard-state advance
 * leaves the user staring at an empty form (codex turn 6 YELLOW #3).
 *
 * UX copy refers to the credential as "master password", not
 * "keystore" — M7 only persists the password, it does not create or
 * unlock an encrypted keystore (codex turn 5 RED #2). Encryption
 * happens later when wallets are generated in M8. Concrete file paths
 * are intentionally not surfaced in the UI (codex turn 6 YELLOW #4).
 */

import { useCallback, useRef, useState, type JSX } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  keystorePasswordSchema,
  type KeystorePasswordInput,
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
import { StrengthMeter } from "../../../components/common/StrengthMeter.js";
import { useEnvState } from "../../../lib/api/onboarding.js";
import {
  nextWizardStateFor,
  useKeystoreSet,
  useSetWizardState,
} from "../../../lib/api/wizard.js";

export interface KeystoreStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
}

const PASSWORD_INPUT_ID = "vex-keystore-password";
const CONFIRM_INPUT_ID = "vex-keystore-confirm";
const PASSWORD_METER_ID = "vex-keystore-password-meter";
const PASSWORD_ERROR_ID = "vex-keystore-password-error";
const CONFIRM_ERROR_ID = "vex-keystore-confirm-error";

function joinIds(...ids: ReadonlyArray<string | false | null | undefined>): string | undefined {
  const filtered = ids.filter((v): v is string => typeof v === "string" && v.length > 0);
  return filtered.length > 0 ? filtered.join(" ") : undefined;
}

export function KeystoreStep({
  completedSteps,
  onAdvance,
}: KeystoreStepProps): JSX.Element {
  const envQuery = useEnvState();
  const keystoreSet = useKeystoreSet();
  const setWizardState = useSetWizardState();

  const [advanceError, setAdvanceError] = useState<string | null>(null);
  // Locally remember that we just persisted the password — so the skip
  // badge renders even before envState query refetches (codex turn 6
  // YELLOW #3). False until the IPC succeeds; never reset (the badge
  // is the right surface from this point on in the same session).
  const [passwordPersisted, setPasswordPersisted] = useState(false);

  const form = useForm<KeystorePasswordInput>({
    resolver: zodResolver(keystorePasswordSchema),
    defaultValues: { password: "", confirm: "" },
    mode: "onChange",
  });

  // RHF returns a `ref` callback inside register(); we ALSO take our
  // own ref so the post-submit clear in handleSubmit guarantees the
  // DOM input is wiped even if RHF state is somehow out-of-sync
  // (defense-in-depth — the value never lingers in the DOM).
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const confirmInputRef = useRef<HTMLInputElement | null>(null);
  const passwordReg = form.register("password");
  const confirmReg = form.register("confirm");

  const passwordValue = form.watch("password");
  const envHasPassword =
    envQuery.data?.ok === true && envQuery.data.data.hasKeystorePassword;
  const hasExisting = passwordPersisted || envHasPassword;
  const envLoading = envQuery.isLoading;

  const advanceToWallets = useCallback(async (): Promise<void> => {
    setAdvanceError(null);
    const next = nextWizardStateFor({
      completedSteps,
      current: "keystore",
      next: "wallets",
    });
    const result = await setWizardState.mutateAsync(next);
    if (!result.ok) {
      setAdvanceError(result.error.message);
      return;
    }
    onAdvance("wallets");
  }, [completedSteps, setWizardState, onAdvance]);

  const onSubmit = form.handleSubmit(async (values) => {
    setAdvanceError(null);
    const ksResult = await keystoreSet.mutateAsync({
      password: values.password,
    });
    if (!ksResult.ok) {
      form.setError("password", {
        type: "server",
        message: ksResult.error.message,
      });
      return;
    }
    // Mark the password as persisted FIRST so any state transition
    // (advanceToWallets failing + user staying on the screen) renders
    // the skip badge instead of the empty form.
    setPasswordPersisted(true);
    // Clear DOM inputs first, then RHF state — order matters because
    // form.reset() will repopulate the input.value if anything is
    // sitting in defaultValues.
    if (passwordInputRef.current) passwordInputRef.current.value = "";
    if (confirmInputRef.current) confirmInputRef.current.value = "";
    form.reset({ password: "", confirm: "" });
    await advanceToWallets();
  });

  if (hasExisting && !envLoading) {
    return (
      <Card className="w-full max-w-2xl" data-vex-wizard-keystore="skip">
        <CardHeader>
          <CardTitle>Master password already configured</CardTitle>
          <CardDescription>
            Vex found a saved master password in your config. Continue to
            keep using it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            To rotate the password, complete setup and use the future
            Settings panel — wallet keystores are not re-encrypted
            automatically when the password changes.
          </p>
          {advanceError ? (
            <p className="text-sm text-destructive" role="alert">
              {advanceError}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                void advanceToWallets();
              }}
              disabled={setWizardState.isPending}
            >
              {setWizardState.isPending ? "Continuing…" : "Continue"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const passwordError = form.formState.errors.password?.message;
  const confirmError = form.formState.errors.confirm?.message;
  const submitting = keystoreSet.isPending || setWizardState.isPending;

  return (
    <Card className="w-full max-w-2xl" data-vex-wizard-keystore="form">
      <CardHeader>
        <CardTitle>Set your master password</CardTitle>
        <CardDescription>
          This password will encrypt your wallet keystores when you create
          them in the next step. It stays on this machine — Vex never
          sends it anywhere.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={PASSWORD_INPUT_ID}>Master password</Label>
            <PasswordField
              id={PASSWORD_INPUT_ID}
              autoFocus
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={joinIds(
                PASSWORD_METER_ID,
                passwordError ? PASSWORD_ERROR_ID : undefined
              )}
              {...passwordReg}
              ref={(el) => {
                passwordReg.ref(el);
                passwordInputRef.current = el;
              }}
            />
            <StrengthMeter id={PASSWORD_METER_ID} value={passwordValue} />
            {passwordError ? (
              <p
                id={PASSWORD_ERROR_ID}
                className="text-xs text-destructive"
                role="alert"
              >
                {passwordError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={CONFIRM_INPUT_ID}>Confirm password</Label>
            <PasswordField
              id={CONFIRM_INPUT_ID}
              aria-invalid={confirmError ? true : undefined}
              aria-describedby={joinIds(
                confirmError ? CONFIRM_ERROR_ID : undefined
              )}
              {...confirmReg}
              ref={(el) => {
                confirmReg.ref(el);
                confirmInputRef.current = el;
              }}
            />
            {confirmError ? (
              <p
                id={CONFIRM_ERROR_ID}
                className="text-xs text-destructive"
                role="alert"
              >
                {confirmError}
              </p>
            ) : null}
          </div>

          {advanceError ? (
            <p className="text-sm text-destructive" role="alert">
              {advanceError}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save and continue"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
