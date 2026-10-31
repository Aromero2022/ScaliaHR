import type { ModuleFlags } from "@/lib/tenant/module-flags";

export interface NavItemConfig {
  href: string;
  label: string;
  moduleFlag?: keyof ModuleFlags;
  permissionKey?: string;
}

export const NAV_ITEMS: NavItemConfig[] = [
  { href: "/dashboard", label: "Inicio (BizX)" },
  { href: "/employees", label: "Empleados (EC)", moduleFlag: "is_ec_active", permissionKey: "ec.view_org_chart" },
  { href: "/profile", label: "Mi Perfil" },
  { href: "/org-chart", label: "Organigrama (EC)", moduleFlag: "is_ec_active", permissionKey: "ec.view_org_chart" },
  { href: "/performance", label: "Desempeño (PMGM)", moduleFlag: "is_pmgm_active", permissionKey: "pmgm.view_own_goals" },
  { href: "/lms", label: "Formación (LMS)", moduleFlag: "is_lms_active", permissionKey: "lms.access" },
  { href: "/skills-hub", label: "Talent Hub (TIH)", moduleFlag: "is_tih_active", permissionKey: "tih.employee_skills" },
  { href: "/admin/arco", label: "Derechos ARCO", permissionKey: "arco.manage" },
  { href: "/admin-center", label: "Admin Center", permissionKey: "admin_center.access" },
];

export function filterNavByFlags(
  items: readonly NavItemConfig[],
  moduleFlags: ModuleFlags | null,
  grantedPermissions?: Set<string>,
): NavItemConfig[] {
  return items.filter((item) => {
    if (item.permissionKey) {
      if (!grantedPermissions?.has(item.permissionKey)) return false;
    }
    if (!item.moduleFlag) return true;
    if (!moduleFlags) return false;
    return moduleFlags[item.moduleFlag];
  });
}
