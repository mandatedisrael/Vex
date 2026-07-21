/**
 * Custom Dialog primitive (M12) — native `<dialog>` element + Tailwind.
 *
 * vex-app deliberately avoids Radix Dialog: the Portal-based primitive
 * needs a CSP audit before adoption (see `MOTION-POLICY.md`), and shipping
 * the shell with one custom 200-line module is cheaper than expanding the
 * Radix surface area.
 *
 * Browser semantics we lean on:
 *   - `dialog.showModal()` traps focus, opens the top-layer, and exposes
 *     the native ESC-to-close intent. We intercept the `cancel` event so
 *     callers receive a single source-of-truth `onOpenChange(false)`.
 *   - Top-layer rendering means we don't need `position: fixed` + z-index
 *     gymnastics; the dialog stays above every painted layer.
 *   - When the dialog closes we restore focus to whatever was focused
 *     before opening (the trigger).
 *
 * CSP: NO inline `style` attributes anywhere. Every effect is Tailwind
 * + classes from `globals.css`. Backdrop styling rides on the native
 * `::backdrop` pseudo-element via a Tailwind arbitrary variant
 * `backdrop:bg-...` so we don't need a separate sibling div.
 *
 * Sub-components mirror shadcn naming so application code reads the
 * same as the rest of the project (`<DialogContent>`, `<DialogHeader>`,
 * `<DialogTitle>`, etc.). They are pure Tailwind wrappers — no Radix
 * Slot or asChild composition.
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactEventHandler,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils.js";

interface DialogContextValue {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly titleId: string;
  readonly descriptionId: string;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(component: string): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (ctx === null) {
    throw new Error(`<${component}> must be used inside <Dialog>.`);
  }
  return ctx;
}

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly children: ReactNode;
}

/**
 * Controlled Dialog root. Owns the `<DialogContext>` so descendants
 * (DialogContent, DialogClose) can read open state and invoke close
 * intent without prop drilling.
 *
 * Renders nothing on its own — descendant `<DialogContent>` paints the
 * actual native `<dialog>` element.
 */
export function Dialog({ open, onOpenChange, children }: DialogProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const value: DialogContextValue = {
    open,
    onOpenChange,
    titleId,
    descriptionId,
  };
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export interface DialogContentProps extends HTMLAttributes<HTMLDialogElement> {
  /**
   * When true (default) the dialog closes on backdrop click. Set to
   * false for destructive prompts that require an explicit choice.
   */
  readonly closeOnBackdropClick?: boolean;
  /**
   * Native `<dialog>` cancel intent (ESC). `HTMLAttributes` does not
   * include it (React types it on `DialogHTMLAttributes` only), so it is
   * declared here to match the wired implementation. Runs before the
   * component routes the close through `onOpenChange(false)`.
   */
  readonly onCancel?: ReactEventHandler<HTMLDialogElement>;
}

/**
 * Native `<dialog>` element wrapper. Owns:
 *  - `showModal()` / `close()` lifecycle keyed off context.open
 *  - ESC handling (the browser fires `cancel` → we route to onOpenChange)
 *  - Backdrop click handling — `mousedown` on the dialog itself (not
 *    children, courtesy of e.target === e.currentTarget check)
 *  - Focus restoration on close
 *
 * Focus trap: the native `<dialog>` element + `showModal()` already
 * provides a real focus trap (Tab cycles inside the dialog, focus can't
 * leave via Shift+Tab). We do NOT reimplement it with JS.
 */
export const DialogContent = forwardRef<HTMLDialogElement, DialogContentProps>(
  (
    {
      className,
      children,
      onClick,
      onCancel,
      closeOnBackdropClick = true,
      ...rest
    },
    ref,
  ) => {
    const { open, onOpenChange, titleId, descriptionId } = useDialogContext(
      "DialogContent",
    );
    const internalRef = useRef<HTMLDialogElement | null>(null);
    const previouslyFocused = useRef<HTMLElement | null>(null);

    const assignRef = useCallback(
      (node: HTMLDialogElement | null): void => {
        internalRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref !== null && ref !== undefined) {
          (ref as React.MutableRefObject<HTMLDialogElement | null>).current = node;
        }
      },
      [ref],
    );

    // Mount/unmount native modal state in step with the controlled prop.
    useEffect(() => {
      const node = internalRef.current;
      if (node === null) return;
      if (open && !node.open) {
        // Capture the active element so we can restore focus on close.
        const active = document.activeElement;
        previouslyFocused.current =
          active instanceof HTMLElement ? active : null;
        try {
          node.showModal();
        } catch {
          // showModal throws if already open (we just checked) or if the
          // dialog is detached. Both are programmer errors; swallow so a
          // misuse during fast unmount doesn't crash the renderer.
        }
      } else if (!open && node.open) {
        node.close();
      }
    }, [open]);

    // Restore focus to the trigger when the dialog closes. We listen on
    // the dialog's `close` event because `showModal` may be ended by
    // native UA shortcuts (e.g. ESC) before React re-runs the open
    // effect.
    useEffect(() => {
      const node = internalRef.current;
      if (node === null) return;
      const handleClose = (): void => {
        const target = previouslyFocused.current;
        if (target !== null && document.contains(target)) {
          target.focus();
        }
        previouslyFocused.current = null;
      };
      node.addEventListener("close", handleClose);
      return () => node.removeEventListener("close", handleClose);
    }, []);

    // ESC: browser fires `cancel` on the dialog. Preventing default
    // keeps the controlled state authoritative — we send the close
    // intent through the same path as a backdrop click.
    const handleCancel = useCallback(
      (event: React.SyntheticEvent<HTMLDialogElement, Event>): void => {
        event.preventDefault();
        onCancel?.(event);
        onOpenChange(false);
      },
      [onCancel, onOpenChange],
    );

    // Backdrop click: native `<dialog>` receives a click whose target
    // is the dialog itself when the click lands on the backdrop.
    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLDialogElement>): void => {
        onClick?.(event);
        if (!closeOnBackdropClick) return;
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      },
      [closeOnBackdropClick, onClick, onOpenChange],
    );

    return (
      <dialog
        ref={assignRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={handleCancel}
        onClick={handleClick}
        className={cn(
          // Center the dialog box itself — keeps backdrop-target clicks
          // on the dialog element, not the inner content (so the
          // currentTarget check above is reliable).
          "fixed inset-0 m-auto max-h-[85vh] w-full max-w-md overflow-hidden",
          // Brand chrome (Chronos glass, owner correction round 2026-07-20):
          // floating glass surface — translucent ink + backdrop-blur carries
          // legibility, a static grain overlay decorates (never a filter on
          // content — the previous DistortedGlass displacement filter warped
          // dialog text and is retired), and the white/10 hairline +
          // rounded-2xl mark it as a floating surface. The rgba fallbacks
          // keep dialogs identical OUTSIDE the shell scope (wizard/unlock),
          // where the --vex-* tokens are undefined.
          "rounded-2xl border border-[var(--vex-line-strong,rgba(255,255,255,0.1))] bg-[var(--vex-glass-strong,rgba(11,15,29,0.82))] p-0 text-card-foreground shadow-none backdrop-blur-xl",
          "backdrop:bg-black/70 backdrop:backdrop-blur-none",
          "open:flex open:flex-col",
          className,
        )}
        {...rest}
      >
        {/* Decorative static grain over the panel — an empty overlay (no
         * filter, no defs), so it works identically in wizard/unlock dialogs
         * mounted outside the shell. -z-10 keeps it under the content. */}
        <div
          aria-hidden
          className="vex-noise vex-noise--panel pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        />
        {children}
      </dialog>
    );
  },
);
DialogContent.displayName = "DialogContent";

export const DialogHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex shrink-0 flex-col gap-1.5 border-b border-border px-6 py-4",
      className,
    )}
    {...props}
  />
));
DialogHeader.displayName = "DialogHeader";

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, id, ...props }, ref) => {
  const ctx = useDialogContext("DialogTitle");
  return (
    <h2
      ref={ref}
      id={id ?? ctx.titleId}
      // Brand modal title — the Chronos editorial serif (Instrument Serif),
      // consistent across every dialog (2026-07-20 redesign; the mono stamp
      // register is retired for dialog titles).
      className={cn(
        "font-serif text-[24px] font-normal leading-tight",
        className,
      )}
      {...props}
    />
  );
});
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, id, ...props }, ref) => {
  const ctx = useDialogContext("DialogDescription");
  return (
    <p
      ref={ref}
      id={id ?? ctx.descriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});
DialogDescription.displayName = "DialogDescription";

export const DialogBody = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5",
      className,
    )}
    {...props}
  />
));
DialogBody.displayName = "DialogBody";

export const DialogFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex shrink-0 flex-row justify-end gap-2 border-t border-border px-6 py-3",
      className,
    )}
    {...props}
  />
));
DialogFooter.displayName = "DialogFooter";

/**
 * Trigger-friendly close button. Routes through context so the user
 * stays on the controlled `onOpenChange` path.
 */
export const DialogClose = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, onClick, type = "button", ...props }, ref) => {
  const { onOpenChange } = useDialogContext("DialogClose");
  return (
    <button
      ref={ref}
      type={type}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onOpenChange(false);
      }}
      className={cn(className)}
      {...props}
    />
  );
});
DialogClose.displayName = "DialogClose";
