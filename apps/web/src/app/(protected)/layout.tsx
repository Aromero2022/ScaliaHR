import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import type { ModuleFlags } from "@/lib/tenant/module-flags";
import { can } from "@/lib/authz/can";
import Sidebar from "@/components/sidebar";

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
      const [adminPerm, arcoPerm] = await Promise.all([
        can(bizUser.id, claims.tenantId!, "admin_center.access", "view"),
        can(bizUser.id, claims.tenantId!, "arco.manage", "view"),
      ]);
      if (adminPerm.allowed) grantedPermissions.push("admin_center.access");
      if (arcoPerm.allowed) grantedPermissions.push("arco.manage");
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar moduleFlags={moduleFlags} grantedPermissions={grantedPermissions} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
