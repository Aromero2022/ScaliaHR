"use client";

// D41 — the navigation of the application shell at three widths, all fed by the
// same list the server already filtered by module flag (D12) and RBP (D14):
// - xl (1280 px and up): full sidebar that can be collapsed (cookie 1/0);
// - md to xl (768–1279 px): icon rail with tooltips;
// - under md: bottom dock with at most 5 entries, the last one "Más" when more
//   modules are enabled, which opens a modal dialog with the rest.
// Only one is displayed at a time (CSS); the others are display:none, so they
// are out of the accessibility tree too.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { clsx } from "clsx";
import { createClient } from "@/lib/supabase/client";
import { focusableIn, trapTab } from "@/lib/navigation/focus-trap";
import { isActivePath, sidebarCookie, splitDock } from "@/lib/navigation/shell";
import {
  AdminIcon,
  CloseIcon,
  CollapseIcon,
  EmployeesIcon,
  HomeIcon,
  LmsIcon,
  LogoutIcon,
  MoreIcon,
  OrgIcon,
  PerformanceIcon,
  ShieldIcon,
  SkillsIcon,
  UserIcon,
} from "./nav-icons";

export type ShellNavItem = { href: string; label: string; shortLabel: string };

const ICONS: Record<string, (props: { active?: boolean }) => React.ReactElement> = {
  "/dashboard": HomeIcon,
  "/employees": EmployeesIcon,
  "/profile": UserIcon,
  "/org-chart": OrgIcon,
  "/performance": PerformanceIcon,
  "/lms": LmsIcon,
  "/skills-hub": SkillsIcon,
  "/admin/arco": ShieldIcon,
  "/admin-center": AdminIcon,
};

function NavIcon({ href, active }: { href: string; active: boolean }) {
  const Icon = ICONS[href] ?? HomeIcon;
  return <Icon active={active} />;
}

const linkTone = (active: boolean) =>
  active ? "bg-accent-subtle text-accent-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg";

type TooltipSide = "right" | "below";

/**
 * 9c PR 6b: the tooltip of icon-only navigation, in the top layer (Popover
 * API), so a scrolling list never cuts it (D44 had to keep the collapsed list
 * from scrolling for that reason). WCAG 1.4.13: it shows on hover and on
 * keyboard focus, stays while the pointer moves onto it, and Esc hides it
 * without moving the pointer or the focus. It describes its control
 * (aria-describedby); the control's name is its visually hidden text.
 */
/** Keyboard focus (or any focus where :focus-visible is not supported). */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

function useTooltip(side: TooltipSide) {
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const state = useRef({ hover: false, focus: false, dismissed: false, open: false });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const r = trigger.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    let left = side === "right" ? r.right + 8 : r.right - box.width;
    let top = side === "right" ? r.top + (r.height - box.height) / 2 : r.bottom + 8;
    left = Math.max(4, Math.min(left, window.innerWidth - box.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - box.height - 4));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }, [side]);

  // Esc hides it until the pointer comes back or the focus moves. A tooltip hidden under
  // the pointer gets no pointerleave, so the hover is cleared here too.
  const onEscape = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    state.current.dismissed = true;
    state.current.hover = false;
    if (state.current.open) tipRef.current?.hidePopover?.();
    state.current.open = false;
  }, []);

  const update = useCallback(() => {
    const tip = tipRef.current;
    if (!tip || typeof tip.showPopover !== "function") return;
    const { hover, focus, dismissed, open } = state.current;
    const visible = (hover || focus) && !dismissed;
    if (visible && !open) {
      tip.showPopover();
      state.current.open = true;
      place();
      document.addEventListener("keydown", onEscape);
      window.addEventListener("scroll", place, true);
    } else if (!visible && open) {
      tip.hidePopover();
      state.current.open = false;
    }
    if (!visible) {
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("scroll", place, true);
    }
  }, [onEscape, place]);

  useEffect(
    () => () => {
      clearTimeout(hideTimer.current);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("scroll", place, true);
    },
    [onEscape, place],
  );

  const enter = () => {
    clearTimeout(hideTimer.current);
    state.current.hover = true;
    update();
  };
  // Pointing at the control again shows a tooltip that Esc had hidden.
  const enterTrigger = () => {
    state.current.dismissed = false;
    enter();
  };
  // A short grace period lets the pointer travel from the control onto the tooltip.
  const leave = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      state.current.hover = false;
      if (!state.current.focus) state.current.dismissed = false;
      update();
    }, 150);
  };

  return {
    trigger: {
      ref: (el: HTMLElement | null) => {
        triggerRef.current = el;
      },
      "aria-describedby": id,
      onPointerEnter: enterTrigger,
      onPointerLeave: leave,
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        state.current.focus = focusVisible(e.currentTarget);
        update();
      },
      onBlur: () => {
        state.current.focus = false;
        state.current.dismissed = false;
        update();
      },
    },
    tooltip: (text: string) => (
      <span
        ref={tipRef}
        id={id}
        popover="manual"
        role="tooltip"
        onPointerEnter={enter}
        onPointerLeave={leave}
        className="fixed inset-auto m-0 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium whitespace-nowrap text-fg shadow-md"
      >
        {text}
      </span>
    ),
  };
}

function NavLink({ item, iconOnly }: { item: ShellNavItem; iconOnly: boolean }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.href);
  const tip = useTooltip("right");
  return (
    <>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        {...(iconOnly ? tip.trigger : {})}
        className={clsx(
          "flex min-h-11 items-center gap-3 rounded-lg text-sm font-medium transition",
          iconOnly ? "justify-center" : "px-3",
          linkTone(active),
        )}
      >
        <NavIcon href={item.href} active={active} />
        {iconOnly ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
      </Link>
      {iconOnly && tip.tooltip(item.label)}
    </>
  );
}

function useSignOut() {
  const router = useRouter();
  return async () => {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  };
}

export function SignOutButton({ iconOnly = false, tooltipSide = "right" }: { iconOnly?: boolean; tooltipSide?: TooltipSide }) {
  const signOut = useSignOut();
  const tip = useTooltip(tooltipSide);
  return (
    <>
      <button
        type="button"
        onClick={signOut}
        {...(iconOnly ? tip.trigger : {})}
        className={clsx(
          "flex min-h-11 w-full items-center gap-3 rounded-lg text-sm font-medium text-fg-muted transition hover:bg-surface-hover hover:text-danger-fg",
          iconOnly ? "min-w-11 justify-center" : "px-3",
        )}
      >
        <LogoutIcon />
        {iconOnly ? <span className="sr-only">Cerrar sesión</span> : <span>Cerrar sesión</span>}
      </button>
      {iconOnly && tip.tooltip("Cerrar sesión")}
    </>
  );
}

/** 1280 px and up: full sidebar; collapsed it shows icons, like the rail. */
export function SidebarNav({ items, initialCollapsed }: { items: ShellNavItem[]; initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const listId = useId();
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = sidebarCookie(next, window.location.protocol === "https:");
  }
  return (
    <nav
      aria-label="Principal"
      data-collapsed={collapsed ? "1" : "0"}
      className={clsx(
        "sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col border-r border-line bg-surface xl:flex",
        collapsed ? "w-20" : "w-64",
      )}
    >
      <div className={clsx("flex p-3", collapsed ? "justify-center" : "justify-end")}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-hover hover:text-fg"
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
      </div>
      {/* D44: with large text the list can be taller than the window; it scrolls in its
          own box so the last modules and "Cerrar sesión" stay reachable. 9c PR 6b: collapsed
          too, now that the tooltips live in the top layer and no box can cut them. */}
      <ul id={listId} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink item={item} iconOnly={collapsed} />
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-3">
        <SignOutButton iconOnly={collapsed} />
      </div>
    </nav>
  );
}

/** 768–1279 px: icon rail. */
export function RailNav({ items }: { items: ShellNavItem[] }) {
  return (
    <nav
      aria-label="Principal"
      className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-20 shrink-0 flex-col border-r border-line bg-surface md:flex xl:hidden"
    >
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink item={item} iconOnly />
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-3">
        <SignOutButton iconOnly />
      </div>
    </nav>
  );
}

const dockItemClass = (active: boolean) =>
  clsx(
    "flex min-h-16 w-full flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition",
    active ? "text-accent-fg" : "text-fg-muted hover:text-fg",
  );

/** Under 768 px: bottom dock, at most 5 entries; "Más" opens the rest in a dialog. */
export function DockNav({ items }: { items: ShellNavItem[] }) {
  const pathname = usePathname();
  const { dock, more } = splitDock(items);
  const [open, setOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const moreActive = more.some((item) => isActivePath(pathname, item.href));

  // A navigation from inside the dialog closes it.
  useEffect(() => setOpen(false), [pathname]);

  function close() {
    setOpen(false);
    moreButton.current?.focus();
  }

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex">
        {dock.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link href={item.href} aria-current={active ? "page" : undefined} className={dockItemClass(active)}>
                <NavIcon href={item.href} active={active} />
                <span className="max-w-full text-center leading-tight hyphens-manual">{item.shortLabel}</span>
              </Link>
            </li>
          );
        })}
        {more.length > 0 && (
          <li className="min-w-0 flex-1">
            <button
              ref={moreButton}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? dialogId : undefined}
              onClick={() => setOpen(true)}
              className={dockItemClass(moreActive)}
            >
              <MoreIcon active={moreActive} />
              <span>Más</span>
            </button>
          </li>
        )}
      </ul>
      {open && <MoreDialog id={dialogId} items={more} onClose={close} />}
    </nav>
  );
}

/**
 * The rest of the modules, as a modal dialog: focus moves in and stays in
 * (Tab and Shift+Tab wrap), Esc or the close button closes it, and the focus
 * goes back to "Más".
 */
export function MoreDialog({ id, items, onClose }: { id: string; items: ShellNavItem[]; onClose: () => void }) {
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = `${id}-title`;

  useEffect(() => {
    if (panel.current) focusableIn(panel.current)[0]?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (panel.current) trapTab(event, panel.current);
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-overlay" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-fg">
            Más secciones
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-hover hover:text-fg"
          >
            <CloseIcon />
            <span className="sr-only">Cerrar</span>
          </button>
        </div>
        <ul className="mt-2 space-y-1">
          {items.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx("flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition", linkTone(active))}
                >
                  <NavIcon href={item.href} active={active} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
