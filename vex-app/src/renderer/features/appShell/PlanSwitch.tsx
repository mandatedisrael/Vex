/**
 * Composer Mode selector — model-picker-style control for session input mode.
 *
 * Presentation-only over engine-owned state: the parent `SessionComposer`
 * reads the plan via `useSessionPlan` and toggles via `useSetPlanMode` —
 * the exact invalidate-based hooks `SessionPlanCard` uses, so there is no
 * optimistic write and a server refusal snaps the switch back on refetch.
 *
 * Today the only meaningful modes are regular Chat and Plan Mode. The dropdown
 * shape is intentional so future modes can join without turning the composer
 * chrome into a row of badges.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils.js";

type ComposerMode = "chat" | "plan";

const MODE_OPTIONS: ReadonlyArray<{
  readonly value: ComposerMode;
  readonly label: string;
}> = [
  { value: "chat", label: "Chat" },
  { value: "plan", label: "Plan Mode" },
];

export interface PlanSwitchProps {
  /** Null on the welcome screen — plan mode needs an open session. */
  readonly sessionId: string | null;
  readonly planOn: boolean;
  /** setPlanMode mutation in flight — wait for the engine's answer. */
  readonly busy: boolean;
  /**
   * Mission run parked for plan acceptance (`paused_plan_acceptance`) —
   * the engine refuses toggles in this state, so disable up front.
   */
  readonly missionBlocked: boolean;
  readonly onToggle: () => void;
}

export function PlanSwitch({
  sessionId,
  planOn,
  busy,
  missionBlocked,
  onToggle,
}: PlanSwitchProps): JSX.Element {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const noSession = sessionId === null;
  const disabled = noSession || missionBlocked || busy;
  const selectedMode: ComposerMode = planOn ? "plan" : "chat";
  const selectedIndex = MODE_OPTIONS.findIndex(
    (option) => option.value === selectedMode,
  );
  const selectedLabel =
    selectedIndex >= 0 ? MODE_OPTIONS[selectedIndex]!.label : "Chat";
  const title = noSession
    ? "Available once a session is open"
    : missionBlocked
      ? "Unavailable while a mission is running"
      : undefined;

  const getOptionId = useCallback(
    (index: number): string => `${listboxId}-mode-${index}`,
    [listboxId],
  );

  const openMenu = useCallback((): void => {
    if (disabled) return;
    setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex);
    setOpen(true);
  }, [disabled, selectedIndex]);

  const chooseMode = useCallback(
    (mode: ComposerMode): void => {
      if (disabled) return;
      setOpen(false);
      buttonRef.current?.focus();
      if ((mode === "plan") !== planOn) {
        onToggle();
      }
    },
    [disabled, onToggle, planOn],
  );

  useEffect((): (() => void) | undefined => {
    if (!open) return undefined;
    const onDocMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (root !== null && !root.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      if (disabled) return;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          if (!open) {
            openMenu();
          } else {
            setActiveIndex((index) => (index + 1) % MODE_OPTIONS.length);
          }
          break;
        case "ArrowUp":
          event.preventDefault();
          if (!open) {
            openMenu();
          } else {
            setActiveIndex(
              (index) => (index - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length,
            );
          }
          break;
        case "Home":
          if (open) {
            event.preventDefault();
            setActiveIndex(0);
          }
          break;
        case "End":
          if (open) {
            event.preventDefault();
            setActiveIndex(MODE_OPTIONS.length - 1);
          }
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (!open) {
            openMenu();
          } else {
            const option = MODE_OPTIONS[activeIndex];
            if (option !== undefined) chooseMode(option.value);
          }
          break;
        case "Escape":
          if (open) {
            event.preventDefault();
            setOpen(false);
          }
          break;
        case "Tab":
          if (open) setOpen(false);
          break;
        default:
          break;
      }
    },
    [activeIndex, chooseMode, disabled, open, openMenu],
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label="Mode"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? getOptionId(activeIndex) : undefined}
        data-vex-plan-mode={planOn ? "on" : "off"}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className={cn(
          // Model-picker grammar: one pill labeled by control kind + current
          // mode. Plan state reads from the selected value and the active tone.
          "inline-flex h-9 min-w-[132px] shrink-0 items-center justify-between gap-2 rounded-full border px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-[160ms]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          planOn
            ? "border-[var(--vex-accent-border)] bg-[var(--vex-accent-fill-8)] text-[var(--vex-accent-text)]"
            : "border-[var(--vex-line-strong)] text-[var(--vex-text-3)] hover:border-[var(--vex-accent-border)] hover:text-[var(--vex-text-2)]",
        )}
      >
        <span className="min-w-0 truncate">
          <span className={planOn ? "text-[var(--vex-accent-text)]" : undefined}>
            Mode
          </span>
          <span className="px-1 text-[var(--vex-line-strong)]">/</span>
          <span className={planOn ? "text-[var(--vex-accent-text)]" : "text-foreground"}>
            {selectedLabel}
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={13}
          aria-hidden
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Mode"
          className="absolute bottom-full left-0 z-30 mb-1 w-44 rounded-lg border border-[var(--vex-line-strong)] bg-[var(--vex-surface-2)] p-1 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground"
        >
          {MODE_OPTIONS.map((option, index) => {
            const active = index === activeIndex;
            const selected = option.value === selectedMode;
            return (
              <li
                key={option.value}
                id={getOptionId(index)}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseMode(option.value)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2",
                  active
                    ? "bg-[var(--vex-accent-fill-12)] text-foreground"
                    : "text-[var(--vex-text-2)]",
                  selected && "text-[var(--vex-accent-text)]",
                )}
              >
                <span>{option.label}</span>
                {selected ? (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--vex-accent)]"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
