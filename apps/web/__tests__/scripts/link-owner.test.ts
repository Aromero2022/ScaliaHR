import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const script = readFileSync(
  path.resolve(__dirname, "../../../../scripts/link-owner.sh"),
  "utf-8",
);

describe("link-owner.sh completeness", () => {
  it("creates the public.users row with employee_id and department_id", () => {
    expect(script).toContain("employee_id");
    expect(script).toContain("department_id");
    expect(script).toMatch(/INSERT INTO public\.users/);
  });

  it("creates user_tenant_memberships with app_role owner", () => {
    expect(script).toContain("user_tenant_memberships");
    expect(script).toContain("'owner'");
  });

  it("creates user_settings with active_tenant_id", () => {
    expect(script).toContain("user_settings");
    expect(script).toContain("active_tenant_id");
  });

  it("inserts group_members via role_grants for the Owner role (no hardcoded UUID)", () => {
    expect(script).toContain("group_members");
    expect(script).toContain("role_grants");
    expect(script).toContain("permission_roles");
    expect(script).toMatch(/lower\(pr\.name\)\s*=\s*'owner'/);
    expect(script).not.toMatch(
      /group_members.*cc100000-0000-0000-0000-000000000001/,
    );
  });

  it("also inserts group_members for the Employee role groups", () => {
    expect(script).toMatch(/lower\(pr\.name\)\s*=\s*'employee'/);
  });

  it("creates ec_personal_information (idempotent)", () => {
    expect(script).toContain("ec_personal_information");
    expect(script).toMatch(/NOT EXISTS[\s\S]*ec_personal_information/);
  });

  it("creates ec_job_information with Director General and department (idempotent)", () => {
    expect(script).toContain("ec_job_information");
    expect(script).toContain("Director General");
    expect(script).toMatch(/NOT EXISTS[\s\S]*ec_job_information/);
  });

  it("is idempotent (uses ON CONFLICT for all inserts)", () => {
    const insertBlocks = script.split(/INSERT INTO/g).slice(1);
    for (const block of insertBlocks) {
      const untilNextStatement = block.split(/;\s*\n/)[0];
      expect(untilNextStatement).toMatch(/ON CONFLICT|NOT EXISTS/i);
    }
  });
});
