import { describe, expect, it } from "vitest";
import { MODULE_FLAG_KEYS, MODULE_FLAGS_SELECT, toModuleFlags } from "@/lib/tenant/module-flags";

describe("module flags", () => {
  it("selects every key, including is_pos_mgmt_active", () => {
    expect(MODULE_FLAGS_SELECT.split(", ")).toEqual([...MODULE_FLAG_KEYS]);
    expect(MODULE_FLAG_KEYS).toContain("is_pos_mgmt_active");
  });

  it("maps a tenant row and treats anything but true as inactive", () => {
    const flags = toModuleFlags({ is_ec_active: true, is_lms_active: "true", is_tih_active: null, extra: true });
    expect(Object.keys(flags)).toEqual([...MODULE_FLAG_KEYS]);
    expect(flags.is_ec_active).toBe(true);
    expect(flags.is_lms_active).toBe(false);
    expect(flags.is_tih_active).toBe(false);
  });

  it("defaults to all inactive without a row", () => {
    expect(Object.values(toModuleFlags(null)).every((v) => v === false)).toBe(true);
  });
});
