import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import type { ModuleFlags } from "@/lib/tenant/module-flags";
import { canMany } from "@/lib/authz/can";
import { NAV_ITEMS } from "@/lib/navigation/nav-config";
import Sidebar from "@/components/sidebar";
import { getCurrentUser } from "@/lib/auth/current-user";

const SIDEBAR_PERMISSION_KEYS = [
  ...new Set(
    NAV_ITEMS.map((i) => i.permissionKey).filter(Boolean) as string[],
  ),
];

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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar moduleFlags={moduleFlags} grantedPermissions={grantedPermissions} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
