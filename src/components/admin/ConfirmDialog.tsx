"use client";

import { useState, type ReactNode } from "react";
import { Spinner } from "./LoginForm";
import { buttonStyles, Dialog } from "@/components/ui/Dialog";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = "primary",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger" | "growth";
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onClose={() => !pending && onClose()} title={title} size="sm">
      <div className="text-navy-600">{body}</div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} disabled={pending} className={buttonStyles.secondary}>
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          className={buttonStyles[tone]}
          onClick={async () => {
            setPending(true);
            try {
              await onConfirm();
            } finally {
              setPending(false);
            }
          }}
        >
          {pending && <Spinner />}
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
