import clsx from "clsx";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button } from "./Button";

/**
 * Modal built on the native <dialog> element (focus trap, Escape and backdrop come for free).
 * Controlled: render it always and toggle `open`. Never use window.alert/confirm/prompt — they are
 * blocked or ugly inside the Contactzilla iframe.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons, right-aligned at the bottom. */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Click on the backdrop (the <dialog> itself, outside the panel) closes.
        if (event.target === event.currentTarget) onClose();
      }}
      className={clsx(
        "m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-gray-200 bg-white p-0 text-gray-900 shadow-xl",
        "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100",
        className,
      )}
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {description}
          </p>
        )}
        {children && <div className="mt-4 text-sm">{children}</div>}
      </div>
      {footer && (
        <div className="flex flex-wrap justify-end gap-2 rounded-b-lg border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-gray-950">
          {footer}
        </div>
      )}
    </dialog>
  );
}

/**
 * Confirmation modal, the replacement for window.confirm(). `onConfirm` may return a promise;
 * the confirm button shows a spinner until it settles, then the dialog closes.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<unknown>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** Red confirm button, for deletes and other irreversible actions. */
  destructive?: boolean;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={confirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
