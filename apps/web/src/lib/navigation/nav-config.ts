import type { ModuleFlags } from "@/lib/tenant/module-flags";

export interface NavItemConfig {
  href: string;
  label: string;
  /** Text under the icon in the mobile dock (D41), where the full label does not fit. */
  shortLabel: string;
  moduleFlag?: keyof ModuleFlags;
  permissionKey?: string;
}

export const NAV_ITEMS: NavItemConfig[] = [
  { href: "/dashboard", label: "Inicio (BizX)", shortLabel: "Inicio" },
  { href: "/employees", label: "Empleados (EC)", shortLabel: "Empleados", moduleFlag: "is_ec_active", permissionKey: "ec.view_org_chart" },
  { href: "/profile", label: "Mi Perfil", shortLabel: "Perfil" },
  { href: "/org-chart", label: "Organigrama (EC)", shortLabel: "Organigrama", moduleFlag: "is_ec_active", permissionKey: "ec.view_org_chart" },
  { href: "/performance", label: "Desempeño (PMGM)", shortLabel: "Desempeño", moduleFlag: "is_pmgm_active", permissionKey: "pmgm.view_own_goals" },
  { href: "/lms", label: "Formación (LMS)", shortLabel: "Formación", moduleFlag: "is_lms_active", permissionKey: "lms.access" },
  { href: "/skills-hub", label: "Talent Hub (TIH)", shortLabel: "Talento", moduleFlag: "is_tih_active", permissionKey: "tih.employee_skills" },
  { href: "/admin/arco", label: "Derechos ARCO", shortLabel: "ARCO", permissionKey: "arco.manage" },
  { href: "/admin-center", label: "Admin Center", shortLabel: "Admin", permissionKey: "admin_center.access" },
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
