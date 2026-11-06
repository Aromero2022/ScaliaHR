import { describe, expect, it } from "vitest";
import { NAV_ITEMS, filterNavByFlags } from "@/lib/navigation/nav-config";
import { DOCK_MAX, SIDEBAR_COOKIE, isActivePath, isSidebarCollapsed, sidebarCookie, splitDock } from "@/lib/navigation/shell";
import { demoLoginHint, isLocalBaseUrl } from "@/lib/auth/demo-hint";

/** D41: the plain logic of the application shell and the demo login hint. */

describe("sidebar cookie (D41)", () => {
  it('collapses only for "1"', () => {
    expect(isSidebarCollapsed("1")).toBe(true);
    expect(isSidebarCollapsed("0")).toBe(false);
  });

  it.each([undefined, null, "", "true", "yes", "01", " 1", "1 ", "collapsed", "<script>", "%31"])(
    "treats %j as expanded",
    (value) => expect(isSidebarCollapsed(value)).toBe(false),
  );

  it("writes 1 or 0 with Path=/, SameSite=Lax and Secure only on https", () => {
    expect(sidebarCookie(true, false)).toBe(`${SIDEBAR_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=31536000`);
    expect(sidebarCookie(false, true)).toBe(`${SIDEBAR_COOKIE}=0; Path=/; SameSite=Lax; Max-Age=31536000; Secure`);
  });
});

describe("mobile dock (D41)", () => {
  it("keeps up to 5 entries and turns the fifth into Más beyond that", () => {
    expect(DOCK_MAX).toBe(5);
    expect(splitDock([1, 2, 3])).toEqual({ dock: [1, 2, 3], more: [] });
    expect(splitDock([1, 2, 3, 4, 5])).toEqual({ dock: [1, 2, 3, 4, 5], more: [] });
    expect(splitDock([1, 2, 3, 4, 5, 6])).toEqual({ dock: [1, 2, 3, 4], more: [5, 6] });
    const all = filterNavByFlags(NAV_ITEMS, null, new Set());
    expect(splitDock(NAV_ITEMS).dock).toHaveLength(4);
    expect(splitDock(NAV_ITEMS).more.map((i) => i.href)).toEqual(NAV_ITEMS.slice(4).map((i) => i.href));
    expect(splitDock(all).more).toEqual([]);
  });

  it("gives every module a short label for the dock whose pieces fit 320 px without being cut", () => {
    for (const item of NAV_ITEMS) {
      const text = item.shortLabel.replaceAll("\u00AD", "");
      expect(text.length, item.href).toBeGreaterThan(0);
      // D43: the short label never contradicts the long name (compared without case: "Perfil" in "Mi perfil").
      const label = item.label.toLowerCase();
      const short = text.toLowerCase();
      expect(label.startsWith(short.slice(0, 4)) || label.includes(short), item.href).toBe(true);
      // 64 px per dock item at 320 px: up to 7 characters a line at 12 px (measured in Inter).
      for (const piece of item.shortLabel.split("\u00AD")) expect(piece.length, `${item.href}: ${piece}`).toBeLessThanOrEqual(7);
    }
  });
});

describe("menu names (D43)", () => {
  it("are the approved names, from the es-MX module, without module codes", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Inicio", "Empleados", "Mi perfil", "Organigrama", "Desempeño", "Formación", "Habilidades", "Derechos ARCO", "Administración",
    ]);
    for (const item of NAV_ITEMS) expect(item.label, item.href).not.toMatch(/\(|\b(BizX|EC|PMGM|LMS|TIH)\b|Talent|Admin Center/);
    expect(NAV_ITEMS.find((i) => i.href === "/skills-hub")!.shortLabel.replaceAll("\u00AD", "")).toBe("Habilidades");
  });
});

describe("active link (D41)", () => {
  it("matches the page and its subpages, not a sibling with the same prefix", () => {
    expect(isActivePath("/employees", "/employees")).toBe(true);
    expect(isActivePath("/employees/123", "/employees")).toBe(true);
    expect(isActivePath("/employees-archive", "/employees")).toBe(false);
    expect(isActivePath("/admin-center", "/admin/arco")).toBe(false);
    expect(isActivePath("/admin/arco", "/admin-center")).toBe(false);
  });
});

describe("demo login hint (D41)", () => {
  const hint = "demo@local.test / Local-Only-1";

  it("is off unless the server variable holds text", () => {
    expect(demoLoginHint({})).toBeNull();
    expect(demoLoginHint({ SCALIA_DEMO_LOGIN_HINT: "   " })).toBeNull();
    expect(demoLoginHint({ SCALIA_DEMO_LOGIN_HINT: hint, NODE_ENV: "development" })).toBe(hint);
  });

  it.each(["http://localhost:3000", "http://acme-corp.localhost:3000", "http://127.0.0.1:3000"])(
    "shows in production on the local host %s",
    (url) => expect(demoLoginHint({ SCALIA_DEMO_LOGIN_HINT: hint, NODE_ENV: "production", APP_BASE_URL: url })).toBe(hint),
  );

  it.each([undefined, "", "not a url", "https://app.scaliahr.com", "https://localhost.evil.test", "https://evil-localhost.test", "http://10.0.0.5:3000"])(
    "is ignored in production when APP_BASE_URL is %j",
    (url) => expect(demoLoginHint({ SCALIA_DEMO_LOGIN_HINT: hint, NODE_ENV: "production", APP_BASE_URL: url })).toBeNull(),
  );

  it("caps the text and recognizes only local hosts", () => {
    expect(demoLoginHint({ SCALIA_DEMO_LOGIN_HINT: "x".repeat(500), NODE_ENV: "development" })).toHaveLength(200);
    expect(isLocalBaseUrl("http://localhost")).toBe(true);
    expect(isLocalBaseUrl("http://127.0.0.2")).toBe(false);
  });
});
