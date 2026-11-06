import { cookies } from "next/headers";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import type { ModuleFlags } from "@/lib/tenant/module-flags";
import { canMany } from "@/lib/authz/can";
import { NAV_ITEMS, filterNavByFlags } from "@/lib/navigation/nav-config";
import { SIDEBAR_COOKIE, isSidebarCollapsed } from "@/lib/navigation/shell";
import { DockNav, RailNav, SidebarNav, SignOutButton, type ShellNavItem } from "@/components/navigation/app-navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

const SIDEBAR_PERMISSION_KEYS = [
  ...new Set(
    NAV_ITEMS.map((i) => i.permissionKey).filter(Boolean) as string[],
  ),
];

// D41: one shell for every protected page. The menu only hides what the user
// cannot open; each page still enforces its own module flag and can() on the
// server, whatever the menu shows.
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const claims = await requireAuth();

  let moduleFlags: ModuleFlags | null = null;
  if (claims.tenantId) {
    moduleFlags = await getModuleFlags(claims.tenantId);
  }

  const grantedPermissions: string[] = [];

  if (claims.tenantId) {
    const bizUser = await getCurrentUser();

    if (bizUser) {
      const results = await canMany(bizUser.id, SIDEBAR_PERMISSION_KEYS, "view");
      for (const [key, result] of results) {
        if (result.allowed) grantedPermissions.push(key);
      }
    }
  }

  const items: ShellNavItem[] = filterNavByFlags(NAV_ITEMS, moduleFlags, new Set(grantedPermissions)).map(
    ({ href, label, shortLabel }) => ({ href, label, shortLabel }),
  );
  const collapsed = isSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-lg"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-on-accent" aria-hidden="true">
          S
        </div>
        <span className="text-lg font-bold text-fg">Scalia HR</span>
        {/* Under 768 px the dock has no room for it; the rail and the sidebar carry their own. */}
        <div className="ml-auto md:hidden">
          <SignOutButton iconOnly tooltipSide="below" />
        </div>
      </header>
      <div className="flex">
        <SidebarNav items={items} initialCollapsed={collapsed} />
        <RailNav items={items} />
        <main
          id="contenido"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] focus:outline-none md:px-6 md:pb-8 xl:px-8"
        >
          {children}
        </main>
      </div>
      <DockNav items={items} />
    </div>
  );
}
