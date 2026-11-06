// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAV_ITEMS } from "@/lib/navigation/nav-config";

/**
 * D41: the navigation in a DOM. The "Más" dialog keeps the keyboard inside
 * and gives the focus back; rail links are named by hidden text, not by their
 * tooltip; the sidebar writes its cookie; and the three variants show the same
 * links.
 */

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));

import { DockNav, RailNav, SidebarNav, SignOutButton } from "@/components/navigation/app-navigation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items = NAV_ITEMS.map(({ href, label, shortLabel }) => ({ href, label, shortLabel }));
let container: HTMLElement;
let root: Root;

beforeEach(() => {
  pathname = "/dashboard";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (element: React.ReactElement) => act(() => root.render(element));
const key = (target: Element, init: KeyboardEventInit) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
/** Text a screen reader reads for an element: everything but aria-hidden subtrees. */
const accessibleText = (el: Element): string =>
  [...el.childNodes]
    .map((n) => (n.nodeType === 3 ? n.textContent : n instanceof Element && n.getAttribute("aria-hidden") !== "true" ? accessibleText(n) : ""))
    .join("")
    .trim();

describe("mobile dock and the Más dialog (D41)", () => {
  it("shows 4 modules and Más, and marks the current page", async () => {
    await render(createElement(DockNav, { items }));
    const links = [...container.querySelectorAll("nav > ul a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(items.slice(0, 4).map((i) => i.href));
    expect(links[0].getAttribute("aria-current")).toBe("page");
    expect(links[1].hasAttribute("aria-current")).toBe(false);
    const more = container.querySelector("button[aria-haspopup='dialog']")!;
    expect(accessibleText(more)).toBe("Más");
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a modal dialog with the focus inside, wraps Tab and Shift+Tab, and Esc returns the focus to Más", async () => {
    await render(createElement(DockNav, { items }));
    const more = container.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!;
    more.focus();
    await act(async () => more.click());

    const dialog = container.querySelector("[role='dialog']")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Más secciones");
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(more.getAttribute("aria-controls")).toBe(dialog.id);

    const focusables = [...dialog.querySelectorAll<HTMLElement>("a[href], button")];
    expect(focusables.map((el) => el.getAttribute("href") ?? accessibleText(el))).toEqual([
      "Cerrar",
      ...items.slice(4).map((i) => i.href),
    ]);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(document.activeElement).toBe(first);

    last.focus();
    await key(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    await key(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    await key(last, { key: "Escape" });
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes with its button too, and highlights Más when the current page is inside it", async () => {
    pathname = "/admin-center";
    await render(createElement(DockNav, { items }));
    const more = container.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!;
    expect(more.className).toContain("text-accent-fg");
    await act(async () => more.click());
    const dialog = container.querySelector("[role='dialog']")!;
    expect(dialog.querySelector("a[href='/admin-center']")!.getAttribute("aria-current")).toBe("page");
    const close = [...dialog.querySelectorAll("button")].find((b) => accessibleText(b) === "Cerrar")!;
    await act(async () => close.click());
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("has no Más when 5 modules or fewer are visible", async () => {
    await render(createElement(DockNav, { items: items.slice(0, 5) }));
    expect(container.querySelectorAll("nav > ul a")).toHaveLength(5);
    expect(container.querySelector("button[aria-haspopup='dialog']")).toBeNull();
  });
});

describe("tablet rail (D41)", () => {
  it("names each link with hidden text; the tooltip is aria-hidden and also shows on keyboard focus", async () => {
    await render(createElement(RailNav, { items }));
    for (const item of items) {
      const link = container.querySelector(`a[href='${item.href}']`)!;
      expect(link.hasAttribute("aria-label")).toBe(false);
      expect(accessibleText(link)).toBe(item.label);
      const tooltip = link.querySelector("[aria-hidden='true'].absolute")!;
      expect(tooltip.textContent).toBe(item.label);
      expect(tooltip.className).toContain("group-hover:visible");
      expect(tooltip.className).toContain("group-focus-visible:visible");
    }
  });

  it("hides the tooltip with Esc and shows it again on the next focus (WCAG 1.4.13)", async () => {
    await render(createElement(RailNav, { items }));
    const link = container.querySelector<HTMLAnchorElement>("a[href='/employees']")!;
    const tooltip = () => link.querySelector("[aria-hidden='true'].absolute")!;
    link.focus();
    await key(link, { key: "Escape" });
    expect(tooltip().className).toMatch(/(^|\s)hidden(\s|$)/);
    await act(async () => link.blur());
    expect(tooltip().className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });
});

describe("header sign-out on mobile (D41)", () => {
  it("opens its tooltip below and toward the left, so it never widens a 320 px page (WCAG 1.4.10)", async () => {
    await render(createElement(SignOutButton, { iconOnly: true, tooltipSide: "below" }));
    const button = container.querySelector("button")!;
    expect(accessibleText(button)).toBe("Cerrar sesión");
    const tooltip = button.querySelector("[aria-hidden='true'].absolute")!;
    expect(tooltip.className).toContain("right-0");
    expect(tooltip.className).not.toContain("left-full");
  });
});

describe("desktop sidebar (D41)", () => {
  it("collapses, writes the cookie with Path, SameSite and no Secure on http, and expands again", async () => {
    const written: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    Object.defineProperty(document, "cookie", { configurable: true, set: (v: string) => written.push(v), get: () => "" });
    try {
      await render(createElement(SidebarNav, { items, initialCollapsed: false }));
      const toggle = container.querySelector<HTMLButtonElement>("button[aria-controls]")!;
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(toggle.getAttribute("aria-label")).toBe("Contraer menú");
      expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toBeNull();
      await act(async () => toggle.click());
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector("nav")!.getAttribute("data-collapsed")).toBe("1");
      await act(async () => toggle.click());
      expect(written).toEqual([
        "scalia_sidebar=1; Path=/; SameSite=Lax; Max-Age=31536000",
        "scalia_sidebar=0; Path=/; SameSite=Lax; Max-Age=31536000",
      ]);
    } finally {
      Object.defineProperty(document, "cookie", descriptor);
      delete (document as { cookie?: string }).cookie;
    }
  });

  it("starts collapsed when the server read the cookie as collapsed", async () => {
    await render(createElement(SidebarNav, { items, initialCollapsed: true }));
    expect(container.querySelector("nav")!.getAttribute("data-collapsed")).toBe("1");
    expect(accessibleText(container.querySelector("a[href='/profile']")!)).toBe("Mi perfil");
  });
});

describe("the three variants show the same modules (D41)", () => {
  it("sidebar, rail and dock (with Más open) list exactly the filtered items", async () => {
    const visible = items.filter((i) => i.href !== "/lms" && i.href !== "/admin/arco");
    const hrefs = () => [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    await render(createElement(SidebarNav, { items: visible, initialCollapsed: false }));
    expect(hrefs()).toEqual(visible.map((i) => i.href));
    await render(createElement(RailNav, { items: visible }));
    expect(hrefs()).toEqual(visible.map((i) => i.href));
    await render(createElement(DockNav, { items: visible }));
    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!.click());
    expect(hrefs()).toEqual(visible.map((i) => i.href));
  });
});
