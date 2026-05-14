/**
 * Polymarket auto-setup — overwrite confirmation modal (feature #7).
 *
 * Shown ONLY when the existing Polymarket status is "configured" and
 * the user has clicked Reconfigure. Confirming closes this modal and
 * opens the SudoModal with `overwriteConfirmed: true`. The flow is
 * deliberately two-modal rather than one combined modal: the existing
 * trio is destructive to overwrite (engine can no longer authenticate
 * with the old creds), and we want the operator to consciously accept
 * that before being prompted for the master password.
 *
 * Backdrop click is disabled — destructive prompts require an explicit
 * choice.
 */

import { useCallback, type JSX } from "react";
import { Button } from "../../../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog.js";

export interface PolymarketConfirmModalProps {
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

/**
 * Inline warning-triangle SVG. Matches AlertTriangle from lucide
 * stylistically but avoids the dependency — vex-app does not ship
 * lucide-react.
 */
function WarningIcon(): JSX.Element {
  return (
    <svg
      aria-hidden
      className="h-5 w-5 text-warning"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function PolymarketConfirmModal({
  onConfirm,
  onClose,
}: PolymarketConfirmModalProps): JSX.Element {
  const handleConfirm = useCallback((): void => {
    onConfirm();
  }, [onConfirm]);

  const handleCancel = useCallback((): void => {
    onClose();
  }, [onClose]);

  return (
    <Dialog
      open={true}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        closeOnBackdropClick={false}
        data-vex-polymarket-confirm="root"
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <WarningIcon />
            <DialogTitle>
              Replace existing Polymarket credentials?
            </DialogTitle>
          </div>
        </DialogHeader>

        <DialogBody>
          <p className="text-sm text-foreground">
            Polymarket is already configured. Auto-setup will derive new
            credentials and overwrite the current ones in the vault. The
            existing credentials will be lost.
          </p>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCancel}
            data-vex-polymarket-confirm-cancel
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            data-vex-polymarket-confirm-replace
          >
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
