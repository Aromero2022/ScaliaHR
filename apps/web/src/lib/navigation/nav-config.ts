import type { ModuleFlags } from "@/lib/tenant/module-flags";

export interface NavItemConfig {
  href: string;
  label: string;
  moduleFlag?: keyof ModuleFlags;
  permissionKey?: string;
}

export const NAV_ITEMS: NavItemConfig[] = [
  { href: "/dashboard", label: "Inicio (BizX)" },
  { href: "/employees", label: "Empleados (EC)", moduleFlag: "is_ec_active" },
  { href: "/profile", label: "Mi Perfil" },
  { href: "/org-chart", label: "Organigrama (EC)", moduleFlag: "is_ec_active" },
  { href: "/performance", label: "Desempeño (PMGM)", moduleFlag: "is_pmgm_active" },
  { href: "/lms", label: "Formación (LMS)", moduleFlag: "is_lms_active" },
  { href: "/skills-hub", label: "Talent Hub (TIH)", moduleFlag: "is_tih_active" },
  { href: "/admin/arco", label: "Derechos ARCO" },
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
