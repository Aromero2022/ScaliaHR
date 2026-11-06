import { requireAal2 } from "@/lib/supabase/claims";
import { redirect, notFound } from "next/navigation";
import { can } from "@/lib/authz/can";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function AdminCenterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const claims = await requireAal2("/admin-center");
  if (!claims.tenantId) redirect("/login");

  const bizUser = await getCurrentUser();

  if (!bizUser) redirect("/login");

  const { allowed } = await can(bizUser.id, "admin_center.access", "view");
  if (!allowed) notFound();

  return <>{children}</>;
}
