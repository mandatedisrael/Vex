import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../utils";

interface ActionModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export const ActionModal: FC<ActionModalProps> = ({ open, onClose, title, children, className }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      document.body.style.overflow = "";
    }

    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center px-4 transition-all duration-200",
        visible ? "bg-black/70 backdrop-blur-md" : "bg-transparent",
      )}
      onClick={(event) => {
        if (event.target === overlayRef.current) onClose();
      }}
    >
      <div
        className={cn(
          "w-full rounded-3xl border border-white/[0.08] bg-zinc-950 p-6 shadow-2xl shadow-black/40 transition-all duration-200 ease-out",
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0",
          className,
        )}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-500 transition-all hover:bg-white/[0.06] hover:text-zinc-300"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
