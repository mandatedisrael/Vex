/**
 * Local-first "Report an issue" dialog.
 *
 * Phase 1 surface:
 *   - Two manual categories (bug / confusion).
 *   - Severity selector (info / warning / error / critical), default `error`.
 *   - Title + description text fields.
 *   - Submit → `window.vex.support.createBugReport`. The renderer never sees
 *     the DB; main does the redaction + insert + (Phase 3) upload enqueue.
 *
 * NOT included in Phase 1 (deferred):
 *   - Diagnostics attachment picker (log file inclusion).
 *   - "My reports" list / export.
 *   - Upload consent toggle.
 *
 * The form is intentionally minimal: every additional field is one more
 * chance for the user to mis-pattern an actual secret into the description
 * before the main-side redactor catches it. We bias toward fewer fields
 * + clearer redaction proof.
 */

import { useCallback, useEffect, useState } from "react";
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
import { Label } from "../../components/ui/label.js";
import { Input } from "../../components/ui/input.js";
import { cn } from "../../lib/utils.js";
import {
  MANUAL_CATEGORIES,
  type ManualCategory,
} from "@shared/schemas/bug-reports.js";

interface ReportIssueDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}

type Severity = "info" | "warning" | "error" | "critical";

interface CategoryOption {
  readonly value: ManualCategory;
  readonly title: string;
  readonly description: string;
}

const CATEGORY_OPTIONS: ReadonlyArray<CategoryOption> = [
  {
    value: "user_reported_bug",
    title: "Bug",
    description: "Something is broken or behaves incorrectly.",
  },
  {
    value: "user_reported_confusion",
    title: "Confusion",
    description: "Something is unclear or surprised you.",
  },
];

const SEVERITY_OPTIONS: ReadonlyArray<{ value: Severity; label: string }> = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
  { value: "critical", label: "Critical" },
];

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 8000;

export function ReportIssueDialog({
  open,
  onOpenChange,
}: ReportIssueDialogProps): JSX.Element {
  const [category, setCategory] = useState<ManualCategory>("user_reported_bug");
  const [severity, setSeverity] = useState<Severity>("error");
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitInfo, setSubmitInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setCategory("user_reported_bug");
      setSeverity("error");
      setTitle("");
      setDescription("");
      setSubmitError(null);
      setSubmitInfo(null);
      setSubmitting(false);
    }
  }, [open]);

  const trimmedTitle = title.trim();
  const formInvalid = trimmedTitle.length === 0 || trimmedTitle.length > TITLE_MAX;
  const submitDisabled = formInvalid || submitting;

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (submitDisabled) return;
      setSubmitError(null);
      setSubmitInfo(null);
      setSubmitting(true);

      const outcome = await window.vex.support.createBugReport({
        reportKind: "manual",
        source: "user",
        category,
        severity,
        title: trimmedTitle,
        description,
        context: {},
        refs: {},
      });

      setSubmitting(false);

      if (!outcome.ok) {
        setSubmitError(outcome.error.message);
        return;
      }
      setSubmitInfo("Report saved locally. Thank you.");
      // Auto-close after a short pause so the success state is visible.
      setTimeout(() => {
        onOpenChange(false);
      }, 800);
    },
    [
      category,
      description,
      onOpenChange,
      severity,
      submitDisabled,
      trimmedTitle,
    ],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col">
          <DialogHeader>
            <DialogTitle>Report an issue</DialogTitle>
            <DialogDescription>
              The report is saved locally on this machine. Secrets are
              automatically redacted before storage. Nothing is sent to a
              remote server in this build.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Category</legend>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORY_OPTIONS.map((opt) => (
                  <CategoryRadio
                    key={opt.value}
                    value={opt.value}
                    checked={category === opt.value}
                    onChange={() => setCategory(opt.value)}
                    title={opt.title}
                    description={opt.description}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Severity</legend>
              <div className="flex flex-row flex-wrap gap-2">
                {SEVERITY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      "cursor-pointer rounded-md border border-border bg-background px-3 py-1.5 text-xs transition-colors",
                      severity === opt.value
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "hover:bg-accent",
                    )}
                  >
                    <input
                      type="radio"
                      name="severity"
                      value={opt.value}
                      checked={severity === opt.value}
                      onChange={() => setSeverity(opt.value)}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-col gap-2">
              <Label htmlFor="vex-report-title">Title</Label>
              <Input
                id="vex-report-title"
                required
                maxLength={TITLE_MAX}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short summary of the issue"
              />
              <div className="flex items-center justify-end text-xs text-[var(--color-text-secondary)]">
                <span aria-live="polite">{title.length} / {TITLE_MAX}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="vex-report-description">Description</Label>
              <textarea
                id="vex-report-description"
                maxLength={DESCRIPTION_MAX}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder="What happened? What did you expect to happen?"
                className={cn(
                  "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                )}
              />
              <div className="flex items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
                <p>
                  Don&apos;t paste passwords, mnemonics, or private keys —
                  redaction is a safety net, not a guarantee.
                </p>
                <span aria-live="polite">
                  {description.length} / {DESCRIPTION_MAX}
                </span>
              </div>
            </div>

            {submitError !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}
            {submitInfo !== null ? (
              <p className="text-sm text-emerald-500" role="status">
                {submitInfo}
              </p>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              {submitting ? "Saving…" : "Save report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CategoryRadioProps {
  readonly value: ManualCategory;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly title: string;
  readonly description: string;
}

function CategoryRadio({
  value,
  checked,
  onChange,
  title,
  description,
}: CategoryRadioProps): JSX.Element {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors",
        checked
          ? "border-primary bg-primary/10 ring-1 ring-primary"
          : "hover:bg-accent",
      )}
    >
      <input
        type="radio"
        name="category"
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span className="font-medium">{title}</span>
      <span className="text-xs text-[var(--color-text-secondary)]">
        {description}
      </span>
    </label>
  );
}
