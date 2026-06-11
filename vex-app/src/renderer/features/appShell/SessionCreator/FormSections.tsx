/**
 * Presentational form sections for the New-session modal (extracted from
 * `SessionCreator.tsx`). Each section is purely presentational — it renders
 * the controlled fields/grids the {@link SessionCreator} owns and threads
 * every value + change handler in through typed props. No hooks, no fetches,
 * no local state: state ownership stays with the parent component.
 *
 * Markup, accessibility roles, and copy are preserved verbatim from the
 * original inline JSX so the modal renders byte-identically.
 */

import type { JSX } from "react";
import {
  SESSION_TITLE_MAX_LENGTH,
  type SessionMode,
  type SessionPermission,
} from "@shared/schemas/sessions.js";
import { Label } from "../../../components/ui/label.js";
import { cn } from "../../../lib/utils.js";
import { WalletSelect, type WalletSelectOption } from "../SessionWalletSelect.js";
import { MODE_OPTIONS, PERMISSION_OPTIONS } from "./options.js";
import { RadioCard } from "./RadioCard.js";

interface NameFieldProps {
  readonly name: string;
  readonly onNameChange: (next: string) => void;
  readonly nameRef: React.RefObject<HTMLInputElement | null>;
}

export function NameField({
  name,
  onNameChange,
  nameRef,
}: NameFieldProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="vex-session-name">Name</Label>
      <input
        ref={nameRef}
        id="vex-session-name"
        type="text"
        required
        maxLength={SESSION_TITLE_MAX_LENGTH}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Give this session a short name."
        className={cn(
          "h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 text-sm shadow-sm",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
        )}
      />
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
        <p>The sidebar uses this as the session title.</p>
        <span aria-live="polite">
          {name.length} / {SESSION_TITLE_MAX_LENGTH}
        </span>
      </div>
    </div>
  );
}

interface ModeFieldsetProps {
  readonly mode: SessionMode;
  readonly onModeChange: (next: SessionMode) => void;
}

export function ModeFieldset({
  mode,
  onModeChange,
}: ModeFieldsetProps): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">Mode</legend>
      <div className="grid grid-cols-2 gap-2">
        {MODE_OPTIONS.map((opt) => (
          <RadioCard
            key={opt.value}
            name="mode"
            value={opt.value}
            checked={mode === opt.value}
            onChange={() => onModeChange(opt.value)}
            title={opt.title}
            description={opt.description}
            icon={opt.icon}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface PermissionFieldsetProps {
  readonly permission: SessionPermission;
  readonly onPermissionChange: (next: SessionPermission) => void;
}

export function PermissionFieldset({
  permission,
  onPermissionChange,
}: PermissionFieldsetProps): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">
        Permission
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {PERMISSION_OPTIONS.map((opt) => (
          <RadioCard
            key={opt.value}
            name="permission"
            value={opt.value}
            checked={permission === opt.value}
            onChange={() => onPermissionChange(opt.value)}
            title={opt.title}
            description={opt.description}
            icon={opt.icon}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface WalletFieldsetProps {
  readonly selectedEvmWalletId: string | null;
  readonly selectedSolanaWalletId: string | null;
  readonly evmOptions: ReadonlyArray<WalletSelectOption>;
  readonly solanaOptions: ReadonlyArray<WalletSelectOption>;
  readonly onEvmChange: (id: string | null) => void;
  readonly onSolanaChange: (id: string | null) => void;
}

export function WalletFieldset({
  selectedEvmWalletId,
  selectedSolanaWalletId,
  evmOptions,
  solanaOptions,
  onEvmChange,
  onSolanaChange,
}: WalletFieldsetProps): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">
        Wallets (optional)
      </legend>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Pick the EVM + Solana wallet this session may use. Locked once the
        session starts; leave empty for a chat-only session.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <WalletSelect
          label="EVM wallet"
          value={selectedEvmWalletId}
          options={evmOptions}
          onChange={onEvmChange}
        />
        <WalletSelect
          label="Solana wallet"
          value={selectedSolanaWalletId}
          options={solanaOptions}
          onChange={onSolanaChange}
        />
      </div>
    </fieldset>
  );
}

interface SubmitErrorProps {
  readonly submitError: string | null;
}

export function SubmitError({ submitError }: SubmitErrorProps): JSX.Element | null {
  if (submitError === null) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {submitError}
    </p>
  );
}
