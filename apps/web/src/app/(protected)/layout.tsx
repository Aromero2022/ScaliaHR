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
      .select("id")
      .eq("auth_uid", claims.userId)
      .single();

    if (bizUser) {
      const { allowed } = await can(bizUser.id, "admin_center.access", "view");
      if (allowed) grantedPermissions.push("admin_center.access");
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar moduleFlags={moduleFlags} grantedPermissions={grantedPermissions} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
