// D41 — the parts of the application shell that are plain logic: the cookie
// that remembers a collapsed sidebar, which links fit in the mobile dock, and
// which link is the current page. No React here, so the server layout and the
// client navigation share it and tests run it directly.

export const SIDEBAR_COOKIE = "scalia_sidebar";
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Only "1" means collapsed; "0", a missing cookie or anything else means expanded. */
export function isSidebarCollapsed(value: string | undefined | null): boolean {
  return value === "1";
}

/** The Set-Cookie value the client writes when the sidebar is toggled. */
export function sidebarCookie(collapsed: boolean, secure: boolean): string {
  return [`${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}`, "Path=/", "SameSite=Lax", `Max-Age=${ONE_YEAR}`, ...(secure ? ["Secure"] : [])].join("; ");
}

/** The dock holds at most this many entries, the last one being "Más" when needed (D19). */
export const DOCK_MAX = 5;

export function splitDock<T>(items: readonly T[], max = DOCK_MAX): { dock: T[]; more: T[] } {
  if (items.length <= max) return { dock: [...items], more: [] };
  return { dock: items.slice(0, max - 1), more: items.slice(max - 1) };
}

/** The link is the current page, or one of its subpages (/employees/123 under /employees). */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
