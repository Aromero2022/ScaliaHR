import { cookies } from "next/headers";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import type { ModuleFlags } from "@/lib/tenant/module-flags";
import { canMany } from "@/lib/authz/can";
import { NAV_ITEMS, filterNavByFlags } from "@/lib/navigation/nav-config";
import { SIDEBAR_COOKIE, isSidebarCollapsed } from "@/lib/navigation/shell";
import { DockNav, RailNav, SidebarNav, SignOutButton, type ShellNavItem } from "@/components/navigation/app-navigation";
import { CommandPalette } from "@/components/navigation/command-palette";
import { CurrentUserUnavailable, getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { ToastProvider } from "@/components/ui/toast";
import { LoadError } from "@/components/ui/load-error";

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
    let bizUser: CurrentUser | null;
    try {
      bizUser = await getCurrentUser();
    } catch (error) {
      // D45: without the employee row there is no menu to build and no page to
      // show; the person sees the error with its request id, not the login.
      if (error instanceof CurrentUserUnavailable) return <UnavailableShell message={error.userMessage} />;
      throw error;
    }

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
    <ToastProvider>
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
        <div className="ml-auto flex items-center gap-2">
          {/* 9c PR 6b: ⌘K over the menu's destinations; people only for who can open the directory. */}
          <CommandPalette items={items} people={items.some((item) => item.href === "/employees")} />
          {/* Under 768 px the dock has no room for it; the rail and the sidebar carry their own. */}
          <div className="md:hidden">
            <SignOutButton iconOnly tooltipSide="below" />
          </div>
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
    </ToastProvider>
  );
}

/** D45: the shell without menu or page, when the signed-in person's employee row could not be read. */
function UnavailableShell({ message }: { message: string }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-on-accent" aria-hidden="true">
          S
        </div>
        <span className="text-lg font-bold text-fg">Scalia HR</span>
        <div className="ml-auto">
          <SignOutButton />
        </div>
      </header>
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-md px-4 pt-12 focus:outline-none">
        <h1 className="mb-4 text-center text-lg font-semibold text-fg">Algo salió mal</h1>
        <LoadError message={message} />
      </main>
    </div>
  );
}
