import { createClient } from "@/lib/supabase/server";
import { requireAal2 } from "@/lib/supabase/claims";
import Link from "next/link";
import RoleManager from "@/components/role-manager";

export interface RoleGrantRow {
  id: string;
  granted_group: { name: string } | null;
  target_population: string;
}

export interface PermissionRoleRow {
  id: string;
  name: string;
  description: string | null;
  is_admin_role: boolean;
  permissions: { permission_key: string; action: string }[];
  grants: RoleGrantRow[];
}

export default async function ManageRolesPage() {
  // AAL2 is enforced here too, not only in the middleware.
  await requireAal2("/admin-center/manage-roles");
  const supabase = await createClient();

  const { data: roles } = await supabase
    .from("permission_roles")
    .select(
      `id, name, description, is_admin_role,
       permissions:role_permissions(permission_key, action),
       grants:role_grants(id, target_population, granted_group:permission_groups!role_grants_granted_group_id_fkey(name))`
    )
    .order("name");

  const { data: groups } = await supabase
    .from("permission_groups")
    .select("id, name, description")
    .order("name");

  const roleRows: PermissionRoleRow[] = (roles ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    is_admin_role: r.is_admin_role,
    permissions: Array.isArray(r.permissions) ? r.permissions : [],
    grants: (Array.isArray(r.grants) ? r.grants : []).map(
      (g: Record<string, unknown>) => ({
        id: g.id as string,
        granted_group: Array.isArray(g.granted_group)
          ? (g.granted_group[0] as { name: string } | null)
          : (g.granted_group as { name: string } | null),
        target_population: (g.target_population as string) ?? "self",
      })
    ),
  }));

  const groupList = (groups ?? []).map((g) => ({
    id: g.id as string,
    name: g.name as string,
    description: g.description as string | null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin-center"
              className="text-sm text-slate-400 transition hover:text-slate-200"
            >
              Admin Center
            </Link>
            <span className="text-slate-600">/</span>
            <span className="text-sm text-slate-300">Gestión de Roles</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white">
            Role-Based Permissions
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Roles de permiso, permisos técnicos asignados y asignaciones de
            grupo
          </p>
        </div>
      </div>

      <RoleManager roles={roleRows} groups={groupList} />
    </div>
  );
}
