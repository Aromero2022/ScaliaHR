import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import type { ModuleFlags } from "@/lib/tenant/module-flags";
import { can } from "@/lib/authz/can";
import { NAV_ITEMS } from "@/lib/navigation/nav-config";
import Sidebar from "@/components/sidebar";

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
    const supabase = await createClient();
    const { data: bizUser } = await supabase
      .from("users")
      .select("id, tenant_id")
      .eq("auth_uid", claims.userId)
      .single();

    if (bizUser) {
      const results = await Promise.all(
        SIDEBAR_PERMISSION_KEYS.map((key) => can(bizUser.id, key, "view")),
      );
      SIDEBAR_PERMISSION_KEYS.forEach((key, i) => {
        if (results[i].allowed) grantedPermissions.push(key);
      });
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar moduleFlags={moduleFlags} grantedPermissions={grantedPermissions} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
