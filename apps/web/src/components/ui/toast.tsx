"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useMotionOn } from "@/components/ui/motion";
import { messages } from "@/lib/i18n/es-MX";

// D43: short success messages after an action. One live region
// (role="status", aria-live="polite") in the protected layout announces them.
// Each one closes by itself after TOAST_MS, but the timer pauses while the
// pointer is over it or the focus is inside it (WCAG 2.2.1), and Esc or its
// button closes it. Errors are not toasts: they stay next to what failed.
// D51: each one fades and slides in and fades out with motion/react. With
// prefers-reduced-motion, or before the animation features load, it has no
// start or exit state, so it appears and leaves at once.

export const TOAST_MS = 5000;

type Toast = { id: number; text: string };
const ToastContext = createContext<{ success: (message: string) => void } | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const success = useCallback((message: string) => {
    const id = next.current++;
    setToasts((all) => [...all, { id, text: message }]);
  }, []);

  return (
    <ToastContext.Provider value={{ success }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 top-16 z-[70] flex flex-col items-end gap-2 md:left-auto md:w-96"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_MS);
  const motionOn = useMotionOn();

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, onDismiss, toast.id]);

  // The m.div only animates; the handlers sit on the plain div inside it. In
  // the image build motion's props are untyped (D51), and there a handler on
  // the m.div would get an implicit any.
  return (
    <m.div
      data-toast=""
      initial={motionOn ? { opacity: 0, y: -8 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={motionOn ? { opacity: 0 } : undefined}
      className="w-full"
    >
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDismiss(toast.id);
        }}
        className="pointer-events-auto flex w-full items-center gap-3 rounded-lg border border-success-line bg-surface py-1 pr-1 pl-4 text-sm text-fg shadow-lg"
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-success" />
        <p className="flex-1">{toast.text}</p>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-hover hover:text-fg"
        >
          <svg aria-hidden="true" focusable="false" className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
          <span className="sr-only">{messages.common.closeMessage}</span>
        </button>
      </div>
    </m.div>
  );
}
