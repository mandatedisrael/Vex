/**
 * Topbar trigger for the local-first "Report an issue" dialog.
 *
 * Phase 1: owns the dialog open state via local React state — there is no
 * cross-feature reason to lift this into useUiStore yet. Lifts when Phase 2
 * adds prefilled-report actions in error states elsewhere in the UI.
 */

import { useCallback, useState } from "react";
import type { JSX } from "react";
import { Button } from "../../components/ui/button.js";
import { ReportIssueDialog } from "./ReportIssueDialog.js";

export function ReportIssueButton(): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const openDialog = useCallback(() => setOpen(true), []);
  const onOpenChange = useCallback((next: boolean) => setOpen(next), []);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={openDialog}
        aria-haspopup="dialog"
      >
        Report an issue
      </Button>
      <ReportIssueDialog open={open} onOpenChange={onOpenChange} />
    </>
  );
}
