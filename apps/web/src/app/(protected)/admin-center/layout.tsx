import { requireAal2 } from "@/lib/supabase/claims";
import { redirect, notFound } from "next/navigation";
import { can } from "@/lib/authz/can";
import { CurrentUserUnavailable, getCurrentUser } from "@/lib/auth/current-user";

export default async function AdminCenterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const claims = await requireAal2("/admin-center");
  if (!claims.tenantId) redirect("/login");

  // D45: a failed read throws CurrentUserUnavailable; the protected layout
  // already shows it with its request id, so this segment renders nothing.
  const bizUser = await getCurrentUser().catch((error: unknown) => {
    if (error instanceof CurrentUserUnavailable) return undefined;
    throw error;
  });
  if (bizUser === undefined) return null;
  if (!bizUser) redirect("/login");

  const { allowed } = await can(bizUser.id, "admin_center.access", "view");
  if (!allowed) notFound();

  return <>{children}</>;
}
