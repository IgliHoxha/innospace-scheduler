"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

/** Shared confirm modal; Escape closes it, focus opens on the safe action. */
export function ConfirmDialog({
  title,
  onClose,
  onConfirm,
  confirmLabel,
  cancelLabel = "No",
  variant = "danger",
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  variant?: "danger" | "primary";
  children: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} ref={cancelRef}>
            {cancelLabel}
          </button>
          <button
            className={variant === "danger" ? "btn danger" : "btn"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
