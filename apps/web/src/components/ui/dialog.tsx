"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { messages } from "@/lib/i18n/es-MX";

// D43: every modal is the native <dialog> opened with showModal(). The browser
// keeps the focus inside, closes it with Esc (a "close" event), makes the rest
// of the page inert and gives the focus back to the element that opened it.
// The title names it (aria-labelledby). Content renders only while open, so a
// form starts empty each time. What is inside a Dialog is its own view for the
// one-primary rule.

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      onClose={onClose}
      className="m-auto max-h-[85dvh] w-[min(100%-2rem,32rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-overlay"
    >
      {open && (
        <>
          <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-3">
            <h2 id={titleId} className="text-lg font-semibold text-fg">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-hover hover:text-fg"
            >
              <svg aria-hidden="true" focusable="false" className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              <span className="sr-only">{messages.common.close}</span>
            </button>
          </div>
          <div className="px-6 py-5">{children}</div>
        </>
      )}
    </dialog>
  );
}
