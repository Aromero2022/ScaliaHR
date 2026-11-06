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
import { useEffect, useId, useRef, useState } from "react";
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

/**
 * A tooltip that shows on hover and on keyboard focus, can be hovered itself
 * (it sits inside the link), and hides with Esc (WCAG 1.4.13). It is
 * aria-hidden: the link's name comes from its visually hidden text.
 */
function Tooltip({ text, hidden }: { text: string; hidden: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "absolute top-1/2 left-full z-50 -translate-y-1/2 pl-2",
        hidden ? "hidden" : "invisible group-hover:visible group-focus-visible:visible",
      )}
    >
      <span className="block rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium whitespace-nowrap text-fg shadow-md">
        {text}
      </span>
    </span>
  );
}

function useTooltipDismiss() {
  const [dismissed, setDismissed] = useState(false);
  return {
    dismissed,
    handlers: {
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") setDismissed(true);
      },
      onBlur: () => setDismissed(false),
      onMouseLeave: () => setDismissed(false),
    },
  };
}

function NavLink({ item, iconOnly }: { item: ShellNavItem; iconOnly: boolean }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.href);
  const tip = useTooltipDismiss();
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      {...(iconOnly ? tip.handlers : {})}
      className={clsx(
        "group relative flex min-h-11 items-center gap-3 rounded-lg text-sm font-medium transition",
        iconOnly ? "justify-center" : "px-3",
        linkTone(active),
      )}
    >
      <NavIcon href={item.href} active={active} />
      {iconOnly ? (
        <>
          <span className="sr-only">{item.label}</span>
          <Tooltip text={item.label} hidden={tip.dismissed} />
        </>
      ) : (
        <span>{item.label}</span>
      )}
    </Link>
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

export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const signOut = useSignOut();
  const tip = useTooltipDismiss();
  return (
    <button
      type="button"
      onClick={signOut}
      {...(iconOnly ? tip.handlers : {})}
      className={clsx(
        "group relative flex min-h-11 w-full items-center gap-3 rounded-lg text-sm font-medium text-fg-muted transition hover:bg-surface-hover hover:text-danger-fg",
        iconOnly ? "min-w-11 justify-center" : "px-3",
      )}
    >
      <LogoutIcon />
      {iconOnly ? (
        <>
          <span className="sr-only">Cerrar sesión</span>
          <Tooltip text="Cerrar sesión" hidden={tip.dismissed} />
        </>
      ) : (
        <span>Cerrar sesión</span>
      )}
    </button>
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
      <ul id={listId} className="flex-1 space-y-1 px-3">
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
      <ul className="flex-1 space-y-1 px-3 py-3">
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
                <span className="max-w-full truncate">{item.shortLabel}</span>
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
