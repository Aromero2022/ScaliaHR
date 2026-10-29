import type { ModuleFlagKey, ModuleFlags } from "./module-flags";

export const MODULE_ROUTE_GUARDS: ReadonlyArray<{
  route: string;
  flag: ModuleFlagKey;
}> = [
  { route: "/skills-hub", flag: "is_tih_active" },
  { route: "/lms", flag: "is_lms_active" },
];

export function isModuleRouteBlocked(
  pathname: string,
  flags: ModuleFlags,
): boolean {
  for (const { route, flag } of MODULE_ROUTE_GUARDS) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return !flags[flag];
    }
  }
  return false;
}
