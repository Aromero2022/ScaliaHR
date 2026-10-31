import { createClient } from "@/lib/supabase/server";
import { requireAal2 } from "@/lib/supabase/claims";
import { redirect, notFound } from "next/navigation";
import { can } from "@/lib/authz/can";

export default async function AdminCenterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const claims = await requireAal2("/admin-center");
  if (!claims.tenantId) redirect("/login");

  const supabase = await createClient();
  const { data: bizUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_uid", claims.userId)
    .single();

  if (!bizUser) redirect("/login");

  const { allowed } = await can(bizUser.id, "admin_center.access", "view");
  if (!allowed) notFound();

  return <>{children}</>;
}
