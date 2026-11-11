"use client";

import { useState, useRef, useId, useTransition } from "react";
import ActionModal, { ACTION_TITLES, type ActionKind } from "@/components/action-modal";
import { Button } from "@/components/ui/button";
import { loadActionOptions, type ActionOptions } from "./actions";

const NO_OPTIONS: ActionOptions = {
  positions: [],
  departments: [],
  jobClassifications: [],
  managers: [],
  locations: [],
  employeeName: "",
};

const actions = [
  { key: "job" as const, label: ACTION_TITLES.job, icon: BriefcaseIcon },
  { key: "compensation" as const, label: ACTION_TITLES.compensation, icon: CurrencyIcon },
  { key: "personal" as const, label: ACTION_TITLES.personal, icon: PersonIcon },
];

/**
 * 9c PR 6b: the menu button pattern of ARIA. The button says it opens a menu
 * (aria-haspopup, aria-expanded, aria-controls); Enter, Space or Down open it
 * on the first option and Up on the last; the arrows, Home and End move
 * between options; Esc closes it and gives the focus back to the button; Tab,
 * a click outside or the focus leaving it close it. While the dialog's lists
 * load, the button shows its loading state (aria-busy) and takes no second
 * click.
 * `today` is the tenant's date (YYYY-MM-DD), computed on the server (D42).
 */
export default function ActionMenu({ employeeId, today }: { employeeId: string; today: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalAction, setModalAction] = useState<ActionKind | null>(null);
  const [options, setOptions] = useState<ActionOptions | null>(null);
  // D45: why the lists could not be loaded; the dialog shows it and does not send.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  // 9c PR 6a: the dialog opens from a menu item that is gone once it closes; the focus goes back here.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const buttonId = useId();
  const menuId = useId();

  function openMenu(focusIndex: number) {
    setMenuOpen(true);
    // The items exist after this render; focus the one asked for.
    requestAnimationFrame(() => itemRefs.current.at(focusIndex)?.focus());
  }

  function closeMenu(returnFocus: boolean) {
    setMenuOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu(-1);
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (index: number) => items.at(index % items.length)?.focus();
    if (e.key === "ArrowDown") move(current + 1);
    else if (e.key === "ArrowUp") move(current - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(-1);
    else if (e.key === "Escape") closeMenu(true);
    else if (e.key === "Tab") {
      closeMenu(false);
      return;
    } else return;
    e.preventDefault();
  }

  // The focus left the button and the menu (Tab from the button, a click elsewhere, another window).
  function onBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) setMenuOpen(false);
  }

  function choose(action: ActionKind) {
    closeMenu(true);
    if (options) {
      setModalAction(action);
      return;
    }
    // D45: read on the server (zod, rate limit, can(), safeError); retried on the next open if it failed.
    startLoading(async () => {
      const result = await loadActionOptions({ employeeId });
      if (result.success) {
        setOptions(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
      setModalAction(action);
    });
  }

  return (
    <>
      <div className="relative" ref={containerRef} onBlur={onBlur}>
        <Button
          ref={triggerRef}
          id={buttonId}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          loading={loading}
          onClick={() => (menuOpen ? closeMenu(false) : openMenu(0))}
          onKeyDown={onTriggerKeyDown}
        >
          Tomar Acción
          <svg
            aria-hidden="true"
            focusable="false"
            className={`h-4 w-4 transition-transform ${menuOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </Button>

        <ul
          id={menuId}
          role="menu"
          aria-labelledby={buttonId}
          hidden={!menuOpen}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-line bg-surface-raised py-1 shadow-lg"
        >
          {actions.map((a, index) => (
            <li key={a.key} role="none">
              <button
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => choose(a.key)}
                className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-fg transition hover:bg-surface-hover focus:bg-surface-hover"
              >
                <a.icon />
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ActionModal
        action={modalAction && (options || loadError) ? modalAction : null}
        onClose={() => {
          setModalAction(null);
          triggerRef.current?.focus();
        }}
        employeeId={employeeId}
        today={today}
        employeeName={(options ?? NO_OPTIONS).employeeName}
        positions={(options ?? NO_OPTIONS).positions}
        departments={(options ?? NO_OPTIONS).departments}
        jobClassifications={(options ?? NO_OPTIONS).jobClassifications}
        managers={(options ?? NO_OPTIONS).managers}
        locations={(options ?? NO_OPTIONS).locations}
        currentPersonal={null}
        loadError={options ? null : loadError}
      />
    </>
  );
}

function BriefcaseIcon() {
  return (
    <svg className="h-4 w-4 text-fg-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function CurrencyIcon() {
  return (
    <svg className="h-4 w-4 text-fg-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg className="h-4 w-4 text-fg-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}
