"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Accessible modal built on the native <dialog> element, which provides
 * focus trapping, Escape-to-close and an inert background.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${size === "sm" ? "max-w-md" : "max-w-lg"} rounded-2xl bg-card p-0 text-navy-900 shadow-2xl open:animate-toast-in`}
    >
      {open && (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="font-display text-xl font-bold">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-1 text-sm text-navy-500">
                  {description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-m-1 rounded-lg p-1.5 text-navy-400 hover:bg-navy-50 hover:text-navy-700"
              aria-label="Close"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
          <div className="mt-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export const buttonStyles = {
  primary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60",
  growth:
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-growth-600 px-4 font-semibold text-white shadow-sm transition-colors hover:bg-growth-700 disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-loss-600 px-4 font-semibold text-white shadow-sm transition-colors hover:bg-loss-700 disabled:cursor-not-allowed disabled:opacity-60",
  secondary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-navy-200 bg-card px-4 font-semibold text-navy-800 shadow-sm transition-colors hover:border-navy-300 hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-navy-600 transition-colors hover:bg-navy-50 hover:text-navy-900 disabled:opacity-50",
};

export const inputStyles =
  "block h-11 w-full rounded-xl border border-navy-200 bg-card px-3.5 text-base text-navy-900 shadow-sm transition-colors placeholder:text-navy-300 hover:border-navy-300 focus:border-growth-500 focus:outline-none focus:ring-2 focus:ring-growth-400/30 aria-[invalid=true]:border-loss-600";
