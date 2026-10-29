// Module flags: the tenants.is_*_active columns are the single source of
// truth. This list mirrors them (an integration test compares both).
export const MODULE_FLAG_KEYS = [
  "is_ec_active",
  "is_pmgm_active",
  "is_sdm_active",
  "is_rcm_active",
  "is_lms_active",
  "is_onb_active",
  "is_comp_active",
  "is_wfa_active",
  "is_wfp_active",
  "is_tme_active",
  "is_tih_active",
  "is_pos_mgmt_active",
] as const;

export type ModuleFlagKey = (typeof MODULE_FLAG_KEYS)[number];
export type ModuleFlags = Record<ModuleFlagKey, boolean>;

export const MODULE_FLAGS_SELECT = MODULE_FLAG_KEYS.join(", ");

/** Missing or non-boolean values count as inactive. */
export function toModuleFlags(row: Partial<Record<string, unknown>> | null | undefined): ModuleFlags {
  return Object.fromEntries(MODULE_FLAG_KEYS.map((key) => [key, row?.[key] === true])) as ModuleFlags;
}
