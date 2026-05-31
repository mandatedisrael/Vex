/**
 * Per-family wallet picker for the New-session modal (extracted from
 * `SessionCreator.tsx` to keep that file under the size budget). Optional
 * per-family wallet scope; "None" = chat-only for that chain.
 *
 * Uses the dark-themed {@link SelectMenu} primitive instead of a native
 * <select> so the option list is readable on the dark modal (native option
 * lists render with the unthemed OS/white chrome).
 */

import type { JSX } from "react";
import { useId, useMemo } from "react";
import { SelectMenu, type SelectMenuOption } from "../../components/ui/select-menu.js";

export interface WalletSelectOption {
  readonly id: string;
  readonly address: string;
  readonly label: string;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletSelect({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly options: ReadonlyArray<WalletSelectOption>;
  readonly onChange: (id: string | null) => void;
}): JSX.Element {
  const labelId = useId();
  const menuOptions = useMemo<ReadonlyArray<SelectMenuOption>>(
    () => [
      // "" is the chat-only sentinel; SelectMenu speaks plain strings, so we
      // map it back to null on change below.
      { value: "", label: "None" },
      ...options.map((w) => ({
        value: w.id,
        label: `${w.label} (${shortenAddress(w.address)})`,
      })),
    ],
    [options],
  );

  return (
    <div className="flex flex-col gap-1 text-xs text-[var(--color-text-secondary)]">
      <span id={labelId}>{label}</span>
      <SelectMenu
        value={value ?? ""}
        options={menuOptions}
        onChange={(next) => onChange(next === "" ? null : next)}
        ariaLabelledBy={labelId}
      />
    </div>
  );
}
