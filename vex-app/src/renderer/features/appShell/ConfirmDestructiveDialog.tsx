/**
 * Reusable confirmation dialog for destructive / lineage-altering
 * actions.
 *
 * Currently used by `KnowledgeSection` for knowledge-base deletion.
 * Default focus lands on Cancel (UX skill §3 — destructive default =
 * least destructive); both buttons disable during pending dispatch so
 * the user can't double-fire while a mutation is mid-flight.
 *
 * Mirrors `SessionDeleteDialog.tsx` so the chat-shell stays
 * stylistically coherent — same Tailwind shadows, same border tones,
 * same backdrop blur.
 */

import type { JSX } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";

export interface ConfirmDestructiveDialogProps {
  /** Render the modal when true; close on `onCancel`. */
  readonly open: boolean;
  /** Dialog title (e.g. "Rewind 3 user turns?"). */
  readonly title: string;
  /** Body copy explaining the consequence. */
  readonly description: string;
  /** Confirm button label (e.g. "Rewind", "Restore", "Renew"). */
  readonly confirmLabel: string;
  /**
   * `destructive` paints the confirm button in the danger tone (red);
   * `primary` keeps it on the brand blue.
   */
  readonly tone: "destructive" | "primary";
  /** Disables both buttons + flips Confirm label to "Working…". */
  readonly pending: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDestructiveDialog({
  open,
  title,
  description,
  confirmLabel,
  tone,
  pending,
  onConfirm,
  onCancel,
}: ConfirmDestructiveDialogProps): JSX.Element {
  const confirmClass =
    tone === "destructive"
      ? "bg-destructive text-destructive-foreground hover:bg-destructive/85"
      : "bg-[#3758ff] text-white hover:bg-[#4668ff]";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <DialogContent
        closeOnBackdropClick={!pending}
        className="max-w-md border-white/[0.10] bg-[#071024]/92 text-foreground shadow-[0_0_80px_rgba(22,68,190,0.28)] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <DialogHeader className="border-white/[0.08]">
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription className="text-[var(--color-text-secondary)]">
            {description}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="gap-3" />

        <DialogFooter className="border-white/[0.08]">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
            autoFocus
            className="text-[var(--color-text-secondary)] hover:bg-white/[0.06] hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={confirmClass}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
