// D44: the screens of the e2e suite and the browser-side checks they share.
import { expect, type Page } from "@playwright/test";

export type Role = "empleada" | "admin";

// Gabriela Morales (e11), the employee account's own record in seed.sql.
const GABRIELA = "e0000000-0000-0000-0000-000000000011";

export const PROTECTED_PAGES: { path: string; name: string; roles: Role[] }[] = [
  { path: "/dashboard", name: "inicio", roles: ["empleada", "admin"] },
  { path: "/employees", name: "empleados", roles: ["empleada", "admin"] },
  { path: `/employees/${GABRIELA}`, name: "empleado-detalle", roles: ["empleada", "admin"] },
  { path: "/profile", name: "mi-perfil", roles: ["empleada", "admin"] },
  { path: "/org-chart", name: "organigrama", roles: ["empleada", "admin"] },
  { path: "/performance", name: "desempeno", roles: ["empleada", "admin"] },
  { path: "/skills-hub", name: "habilidades", roles: ["empleada", "admin"] },
  { path: "/admin/arco", name: "arco", roles: ["admin"] },
  { path: "/admin-center", name: "administracion", roles: ["admin"] },
  { path: "/admin-center/manage-roles", name: "roles", roles: ["admin"] },
];

export const WIDTHS = [360, 768, 1280] as const;
export const HEIGHTS: Record<(typeof WIDTHS)[number], number> = { 360: 800, 768: 1024, 1280: 800 };
export const THEMES = ["light", "dark"] as const;

/**
 * Switches prefers-color-scheme and waits for the color transitions it starts
 * (the transition tokens of D40): axe must read the final colors, not a frame
 * halfway between the two themes.
 */
export async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => undefined)));
  });
}

/**
 * Console errors, uncaught errors and CSP violations of a page, from the
 * moment this is called. The one thing left out is the browser's own request
 * for /favicon.ico: the app has no favicon yet (the tenant's arrives with the
 * Theme Manager, Phase 11), and only full Chrome asks for it, not the headless
 * shell CI runs.
 */
export function watchPage(page: Page): () => string[] {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const source = msg.location().url;
    if (source && new URL(source).pathname === "/favicon.ico") return;
    problems.push(`console: ${msg.text()}${source ? ` (${new URL(source).pathname})` : ""}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  void page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return () => [...problems];
}

/** Opens a protected page and checks that it rendered for this account: no redirect, an h1 in main. */
export async function openProtected(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `${path} status`).toBe(200);
  expect(new URL(page.url()).pathname, `${path} was redirected`).toBe(path);
  await expect(page.locator("main h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

export type LayoutReport = {
  horizontalScroll: number;
  clipped: string[];
  spilled: string[];
  overlaps: string[];
  offscreen: string[];
  unreachable: string[];
};

/**
 * What a reader would lose: horizontal scroll of the page, text cut by a box
 * that hides its overflow, text pushed off the left edge, and pieces of text
 * or controls drawn on top of each other. Hidden elements (display none,
 * visibility hidden, visually hidden text) are left out, and so is what lies
 * outside a scroll container's visible box, which can be scrolled into view.
 * Overlaps are looked for within one layer: the page, or one fixed or sticky
 * bar (the header, the dock). Content passing under a bar is not an overlap:
 * it scrolls out from under it (D41 keeps room for that). What a fixed or
 * sticky bar draws outside the window is unreachable: scrolling the page does
 * not move it into view. A full-page screenshot stretches the window and
 * hides this, so it is measured here.
 */
export async function layoutProblems(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const shown = (el: Element) => {
      const style = getComputedStyle(el);
      if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    type Box = { left: number; top: number; right: number; bottom: number };
    const intersect = (a: Box, b: Box): Box => ({
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    });
    /**
     * The part of a box that is not clipped away by a scrolling or clipping box.
     * For text that box can be its own element (a <pre> with overflow: auto,
     * seen in D46 with an audit diff): the lines below its visible box are
     * scrolled into view, not drawn over the next entry. For a control, its own
     * box changes nothing.
     */
    const visiblePart = (el: Element, box: Box): Box | null => {
      let out = box;
      for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") out = intersect(out, p.getBoundingClientRect());
        if (out.right - out.left <= 0 || out.bottom - out.top <= 0) return null;
      }
      return out;
    };

    const doc = document.documentElement;
    const horizontalScroll = Math.max(0, doc.scrollWidth - doc.clientWidth);

    const clipped: string[] = [];
    // Text wider than its own box with visible overflow spills over whatever is
    // next to it, even when the neighbour's text happens to start a few pixels
    // further on (seen in CI: a stat label 101 px wider than its tile).
    const spilled: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (!shown(el) || !el.textContent?.trim()) continue;
      const s = getComputedStyle(el);
      const hidesX = s.overflowX === "hidden" || s.overflowX === "clip" || s.textOverflow === "ellipsis";
      const hidesY = s.overflowY === "hidden" || s.overflowY === "clip";
      if ((hidesX && el.scrollWidth > el.clientWidth + 1) || (hidesY && el.scrollHeight > el.clientHeight + 1)) clipped.push(describe(el));
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (ownText && s.overflowX === "visible" && !s.display.startsWith("inline") && el.scrollWidth > el.clientWidth + 1) {
        spilled.push(`${describe(el)} "${el.textContent.trim().slice(0, 24)}"`);
      }
    }

    const layerOf = (el: Element): Element | null => {
      for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        const position = getComputedStyle(p).position;
        if (position === "fixed" || position === "sticky") return p;
      }
      return null;
    };
    type Piece = { el: Element; box: Box; label: string; layer: Element | null };
    const pieces: Piece[] = [];
    const offscreen: string[] = [];
    const unreachable: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || !node.textContent?.trim() || !shown(el) || el.closest("script,style,noscript")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;
        const box = visiblePart(el, rect);
        if (!box) continue;
        if (box.left < -1) offscreen.push(`${describe(el)} "${node.textContent.trim().slice(0, 24)}"`);
        if (layerOf(el) && (box.bottom > window.innerHeight + 1 || box.top < -1)) unreachable.push(`${describe(el)} "${node.textContent.trim().slice(0, 24)}"`);
        pieces.push({ el, box, label: `${describe(el)} "${node.textContent.trim().slice(0, 24)}"`, layer: layerOf(el) });
      }
    }
    for (const el of document.body.querySelectorAll("input,select,textarea,button,img,svg")) {
      if (!shown(el)) continue;
      const box = visiblePart(el, el.getBoundingClientRect());
      if (box) pieces.push({ el, box, label: describe(el), layer: layerOf(el) });
    }
    const overlaps: string[] = [];
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i];
        const b = pieces[j];
        if (a.layer !== b.layer || a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const o = intersect(a.box, b.box);
        const w = o.right - o.left;
        const h = o.bottom - o.top;
        const minHeight = Math.min(a.box.bottom - a.box.top, b.box.bottom - b.box.top);
        // A shared edge or the few pixels a tight line height lets glyph boxes touch are not an overlap.
        if (w > 4 && h > Math.max(4, minHeight * 0.3)) overlaps.push(`${a.label} × ${b.label}`);
      }
    }
    return {
      horizontalScroll,
      clipped: [...new Set(clipped)],
      spilled: [...new Set(spilled)],
      overlaps: [...new Set(overlaps)],
      offscreen: [...new Set(offscreen)],
      unreachable: [...new Set(unreachable)],
    };
  });
}

/**
 * A full-page screenshot with the fixed bars where a person sees them. A
 * Playwright fullPage screenshot leaves a fixed dock where it was in the
 * window, halfway down the picture; here the window grows to the page's
 * height for the shot and then goes back.
 */
export async function captureFullPage(page: Page, file: string): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport to restore");
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.max(height, viewport.height) });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: file });
  await page.setViewportSize(viewport);
}
