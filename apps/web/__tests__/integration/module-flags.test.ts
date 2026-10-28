import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, claimsOf } from "./helpers/world";
import { MODULE_FLAG_KEYS, toModuleFlags } from "@/lib/tenant/module-flags";

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();

const world = new TestWorld(env, db);

afterAll(async () => {
  await world.cleanup();
  await db.end();
});

describe("module flags", () => {
  it("MODULE_FLAG_KEYS matches the tenants is_*_active columns", async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name::text, data_type::text, is_nullable::text
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name LIKE 'is\\_%\\_active'`);
    expect(rows.map((r) => r.column_name).sort()).toEqual([...MODULE_FLAG_KEYS].sort());
    for (const row of rows) {
      expect(row, row.column_name).toMatchObject({ data_type: "boolean" });
    }
  });

  it("flags disabled in the DB yield false via toModuleFlags", async () => {
    const tenant = await world.createTenant();
    // Disable LMS and TIH flags for this tenant
    await db.query(
      "UPDATE public.tenants SET is_lms_active = false, is_tih_active = false WHERE id = $1",
      [tenant.id],
    );
    const { rows } = await db.query(
      `SELECT ${MODULE_FLAG_KEYS.join(", ")} FROM public.tenants WHERE id = $1`,
      [tenant.id],
    );
    const flags = toModuleFlags(rows[0] as Record<string, unknown>);
    expect(flags.is_lms_active).toBe(false);
    expect(flags.is_tih_active).toBe(false);
    // EC and PMGM were set true by createTenant
    expect(flags.is_ec_active).toBe(true);
    expect(flags.is_pmgm_active).toBe(true);
  });

  it("flags enabled in the DB yield true via toModuleFlags", async () => {
    const tenant = await world.createTenant();
    // Enable LMS flag
    await db.query(
      "UPDATE public.tenants SET is_lms_active = true WHERE id = $1",
      [tenant.id],
    );
    const { rows } = await db.query(
      `SELECT ${MODULE_FLAG_KEYS.join(", ")} FROM public.tenants WHERE id = $1`,
      [tenant.id],
    );
    const flags = toModuleFlags(rows[0] as Record<string, unknown>);
    expect(flags.is_lms_active).toBe(true);
  });

  it("RLS: a user can read their own tenant's flags but not another tenant's", async () => {
    const tenantA = await world.createTenant();
    const tenantB = await world.createTenant();

    // Disable a flag on tenant B to make it distinguishable
    await db.query(
      "UPDATE public.tenants SET is_ec_active = false WHERE id = $1",
      [tenantB.id],
    );

    // Tenant A's admin reads tenants: should see only their own tenant
    const { data: rowsA, error: errA } = await tenantA.admin.client
      .from("tenants")
      .select(MODULE_FLAG_KEYS.join(", "))
      .eq("id", tenantA.id)
      .single();
    expect(errA).toBeNull();
    expect(rowsA).toBeTruthy();
    const flagsA = toModuleFlags(rowsA as unknown as Record<string, unknown>);
    expect(flagsA.is_ec_active).toBe(true);

    // Tenant A's admin tries to read tenant B's flags → RLS blocks
    const { data: crossRead, error: crossErr } = await tenantA.admin.client
      .from("tenants")
      .select(MODULE_FLAG_KEYS.join(", "))
      .eq("id", tenantB.id)
      .single();

    // RLS should prevent cross-tenant reads: either null data or error
    if (crossRead) {
      // If somehow returned, fail the test
      expect.unreachable("Cross-tenant read should be blocked by RLS");
    }
    expect(crossErr).toBeTruthy();
  });

  it("RLS: a user cannot update another tenant's flags", async () => {
    const tenantA = await world.createTenant();
    const tenantB = await world.createTenant();

    // Tenant A's admin tries to enable LMS on tenant B
    const { error: updateErr, count } = await tenantA.admin.client
      .from("tenants")
      .update({ is_lms_active: true })
      .eq("id", tenantB.id);

    // Verify tenant B's flag was NOT changed
    const { rows } = await db.query(
      "SELECT is_lms_active FROM public.tenants WHERE id = $1",
      [tenantB.id],
    );
    // createTenant doesn't set is_lms_active, so it defaults to false
    expect(rows[0].is_lms_active).toBe(false);
  });
});
