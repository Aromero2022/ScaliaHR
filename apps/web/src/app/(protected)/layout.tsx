import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import type { ModuleFlags } from "@/lib/tenant/module-flags";
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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar moduleFlags={moduleFlags} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
