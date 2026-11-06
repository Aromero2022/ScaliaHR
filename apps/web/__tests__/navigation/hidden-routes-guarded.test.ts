import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV_ITEMS, filterNavByFlags } from "@/lib/navigation/nav-config";
import type { ModuleFlags } from "@/lib/tenant/module-flags";

/**
 * D41: the menu only hides what the user cannot open; it is never the guard.
 * For every module the menu can hide, the page itself (or, for Admin Center,
 * its layout) is opened with the module turned off and then without the
 * permission: the menu leaves it out, and the server still refuses it with a
 * redirect, a 404 or the access-denied page.
 */

const state = { flags: {} as ModuleFlags, perms: new Set<string>() };
const claims = { userId: "auth-1", tenantId: "tenant-1", appRole: "employee", aal: "aal2" };

vi.mock("@/lib/supabase/claims", () => ({
  requireAuth: vi.fn(async () => claims),
  requireAal2: vi.fn(async () => claims),
  getClaims: vi.fn(async () => claims),
}));
vi.mock("@/lib/tenant/get-module-flags", () => ({ getModuleFlags: vi.fn(async () => state.flags) }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "user-1", tenant_id: "tenant-1", position_id: null })),
}));
vi.mock("@/lib/authz/can", () => ({
  can: vi.fn(async (_user: string, key: string) => ({ allowed: state.perms.has(key) })),
  canMany: vi.fn(async (_user: string, keys: string[]) => new Map(keys.map((k) => [k, { allowed: state.perms.has(k) }]))),
}));
// Any query resolves to one row: the guards must refuse before the data matters.
const query: unknown = new Proxy(() => query, {
  get: (_t, prop) =>
    prop === "then"
      ? (resolve: (v: unknown) => void) => resolve({ data: { id: "user-1" }, error: null, count: 0 })
      : () => query,
});
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: () => query, rpc: () => query })) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

type Guarded = (props: Record<string, unknown>) => unknown;
const GUARDS: Record<string, () => Promise<{ default: unknown }>> = {
  "/employees": () => import("@/app/(protected)/employees/page"),
  "/org-chart": () => import("@/app/(protected)/org-chart/page"),
  "/performance": () => import("@/app/(protected)/performance/page"),
  "/lms": () => import("@/app/(protected)/lms/page"),
  "/skills-hub": () => import("@/app/(protected)/skills-hub/page"),
  "/admin/arco": () => import("@/app/(protected)/admin/arco/page"),
  // Admin Center checks its permission in the layout, for every page under it.
  "/admin-center": () => import("@/app/(protected)/admin-center/layout"),
};

const ALL_FLAGS = Object.fromEntries(
  NAV_ITEMS.filter((i) => i.moduleFlag).map((i) => [i.moduleFlag!, true]),
) as unknown as ModuleFlags;
const ALL_PERMS = new Set(NAV_ITEMS.map((i) => i.permissionKey).filter(Boolean) as string[]);

/** "blocked: …" when the server refused the route, "rendered" when it would show it. */
async function open(href: string): Promise<string> {
  const Page = (await GUARDS[href]()).default as Guarded;
  try {
    const element = await Page({ searchParams: Promise.resolve({}), params: Promise.resolve({}), children: "PAGE" });
    const html = renderToStaticMarkup(element as React.ReactElement);
    return html.includes("Acceso denegado") ? "blocked: access denied" : "rendered";
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT") || message === "NOT_FOUND") return `blocked: ${message}`;
    throw error;
  }
}

const hidden = (href: string) => !filterNavByFlags(NAV_ITEMS, state.flags, state.perms).some((i) => i.href === href);

beforeEach(() => {
  state.flags = { ...ALL_FLAGS };
  state.perms = new Set(ALL_PERMS);
});

describe("routes the menu hides stay blocked on the server (D41)", () => {
  it("covers every module the menu can hide", () => {
    const hideable = NAV_ITEMS.filter((i) => i.moduleFlag || i.permissionKey).map((i) => i.href);
    expect(Object.keys(GUARDS).sort()).toEqual(hideable.sort());
  });

  for (const item of NAV_ITEMS.filter((i) => i.moduleFlag)) {
    it(`${item.href}: with ${item.moduleFlag} off the menu hides it and the server refuses it`, async () => {
      state.flags = { ...ALL_FLAGS, [item.moduleFlag!]: false };
      expect(hidden(item.href)).toBe(true);
      expect(await open(item.href)).toMatch(/^blocked/);
    });
  }

  for (const item of NAV_ITEMS.filter((i) => i.permissionKey)) {
    it(`${item.href}: without ${item.permissionKey} the menu hides it and the server refuses it`, async () => {
      state.perms.delete(item.permissionKey!);
      expect(hidden(item.href)).toBe(true);
      expect(await open(item.href)).toMatch(/^blocked/);
    });
  }
});
