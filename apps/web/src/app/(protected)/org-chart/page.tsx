import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import { isModuleRouteBlocked } from "@/lib/tenant/module-guards";
import { can } from "@/lib/authz/can";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/access-denied";
import OrgTree from "@/components/org-tree";
import type { PositionNode } from "@/components/org-tree";

export default async function OrgChartPage() {
  const claims = await requireAuth();
  if (!claims.tenantId) redirect("/dashboard");

  const flags = await getModuleFlags(claims.tenantId);
  if (isModuleRouteBlocked("/org-chart", flags)) redirect("/dashboard");

  const supabase = await createClient();

  const { data: bizUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_uid", claims.userId)
    .single();

  if (!bizUser) redirect("/login");

  const { allowed } = await can(bizUser.id, "ec.view_org_chart", "view");
  if (!allowed) return <AccessDenied />;

  const { data: positions } = await supabase
    .from("positions")
    .select(
      "id, position_code, title, is_vacant, parent_position_id, departments(name), job_classifications(title), occupants:users(first_name, last_name, email)"
    )
    .order("title", { ascending: true });

  const nodes: PositionNode[] = (positions ?? []).map((p) => {
    const dept = Array.isArray(p.departments)
      ? p.departments[0]
      : p.departments;
    const jc = Array.isArray(p.job_classifications)
      ? p.job_classifications[0]
      : p.job_classifications;
    const occ = Array.isArray(p.occupants) ? p.occupants[0] : p.occupants;

    return {
      id: p.id,
      position_code: p.position_code,
      title: p.title,
      is_vacant: p.is_vacant,
      parent_position_id: p.parent_position_id,
      department_name: (dept as Record<string, string> | null)?.name ?? null,
      occupant_name: occ
        ? `${(occ as Record<string, string>).first_name} ${(occ as Record<string, string>).last_name}`
        : null,
      occupant_email: (occ as Record<string, string> | null)?.email ?? null,
      job_classification_title:
        (jc as Record<string, string> | null)?.title ?? null,
    };
  });

  const totalPositions = nodes.length;
  const vacantCount = nodes.filter((n) => n.is_vacant).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">
          Organigrama — Position Management
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Estructura jerárquica basada en posiciones ({totalPositions}{" "}
          posiciones, {vacantCount} vacantes)
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8">
        <OrgTree positions={nodes} />
      </div>
    </div>
  );
}
