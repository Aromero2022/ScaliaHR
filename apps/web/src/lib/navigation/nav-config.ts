import type { ModuleFlags } from "@/lib/tenant/module-flags";
import { messages } from "@/lib/i18n/es-MX";

export interface NavItemConfig {
  href: string;
  label: string;
  /**
   * Text under the icon in the mobile dock (D41), where the full label does not
   * fit. Long words carry soft hyphens (\u00AD): at 320 px they break onto a
   * second line with a hyphen instead of being cut off.
   */
  shortLabel: string;
  moduleFlag?: keyof ModuleFlags;
  permissionKey?: string;
}

const nav = messages.nav;

/** D43: the names come from the es-MX module, without module codes. */
export const NAV_ITEMS: NavItemConfig[] = [
  { href: "/dashboard", label: nav.dashboard.label, shortLabel: nav.dashboard.short },
  { href: "/employees", label: nav.employees.label, shortLabel: nav.employees.short, moduleFlag: "is_ec_active", permissionKey: "ec.view_org_chart" },
  { href: "/profile", label: nav.profile.label, shortLabel: nav.profile.short },
  { href: "/org-chart", label: nav.orgChart.label, shortLabel: nav.orgChart.short, moduleFlag: "is_ec_active", permissionKey: "ec.view_org_chart" },
  { href: "/performance", label: nav.performance.label, shortLabel: nav.performance.short, moduleFlag: "is_pmgm_active", permissionKey: "pmgm.view_own_goals" },
  { href: "/lms", label: nav.lms.label, shortLabel: nav.lms.short, moduleFlag: "is_lms_active", permissionKey: "lms.access" },
  { href: "/skills-hub", label: nav.skills.label, shortLabel: nav.skills.short, moduleFlag: "is_tih_active", permissionKey: "tih.employee_skills" },
  { href: "/admin/arco", label: nav.arco.label, shortLabel: nav.arco.short, permissionKey: "arco.manage" },
  { href: "/admin-center", label: nav.adminCenter.label, shortLabel: nav.adminCenter.short, permissionKey: "admin_center.access" },
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
