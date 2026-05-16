/**
 * Numeric form row used by `AgentCoreStep` — extracted to keep the
 * step screen file under the 400-LOC scalability ceiling (V2 refactor).
 *
 * The row pairs a free-text input with a Reset toggle. The disabled
 * state when `state.kind === "clear"` is the visual signal that
 * submit will REMOVE the key from .env on save. The helper copy under
 * the input swaps to the will-clear hint so the operator is never
 * surprised by an empty input that "resets to default".
 */

import type { JSX } from "react";

import { Button } from "../../../../components/ui/button.js";
import { Input } from "../../../../components/ui/input.js";
import { Label } from "../../../../components/ui/label.js";
import type { FieldState } from "./form-state.js";

export interface NumericRowProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly hint?: string;
  readonly state: FieldState;
  readonly onChange: (next: FieldState) => void;
  readonly defaultLabel: string;
}

export function NumericRow({
  id,
  label,
  placeholder,
  hint,
  state,
  onChange,
  defaultLabel,
}: NumericRowProps): JSX.Element {
  const value = state.kind === "set" ? state.raw : "";
  const cleared = state.kind === "clear";
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          disabled={cleared}
          onChange={(e) =>
            onChange(
              e.target.value.length === 0
                ? { kind: "unchanged" }
                : { kind: "set", raw: e.target.value },
            )
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange(
              state.kind === "clear" ? { kind: "unchanged" } : { kind: "clear" },
            )
          }
        >
          {cleared ? "Undo reset" : "Reset"}
        </Button>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        {cleared
          ? `Will clear on save → ${defaultLabel}`
          : (hint ?? `Default: ${defaultLabel}`)}
      </p>
    </div>
  );
}
