import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { integrationEnv } from "./helpers/env";
import { claimsOf, TestWorld, type TestTenant, type TestUser } from "./helpers/world";

/**
 * tenants: members read their own tenant; only the owner updates it, and only
 * descriptive fields and module flags; nobody authenticated inserts or deletes.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;
let otherTenant: TestTenant;
let owner: TestUser;
let rbpAdmin: TestUser;

async function tenantRow(id: string) {
  const { rows } = await db.query<{ name: string; slug: string; is_lms_active: boolean }>(
    "SELECT name, slug, is_lms_active FROM public.tenants WHERE id = $1",
    [id],
  );
  return rows[0];
}

beforeAll(async () => {
  tenant = await world.createTenant();
  otherTenant = await world.createTenant();
  owner = await world.addMember(tenant.id, "owner");
  rbpAdmin = await world.addMember(tenant.id, "employee");
  await db.query(
    `INSERT INTO public.group_members (tenant_id, group_id, user_id)
     VALUES ($1, $2, $3)`,
    [tenant.id, tenant.adminGroupId, rbpAdmin.userId],
  );
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("tenants — read", () => {
  it("members, admins and the owner read their own tenant only", async () => {
    for (const user of [tenant.employee, tenant.admin, owner]) {
      const { data, error } = await user.client.from("tenants").select("id");
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id)).toEqual([tenant.id]);
    }
  });

  it("anon reads no tenant", async () => {
    const { data, error } = await world.anon.from("tenants").select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe("tenants — update", () => {
  it("the owner token carries app_role owner", () => {
    expect(claimsOf(owner.token).app_role).toBe("owner");
  });

  it("the owner updates the name and module flags of their tenant", async () => {
    const before = await tenantRow(tenant.id);
    const { error } = await owner.client
      .from("tenants")
      .update({ name: "Renamed by owner", is_lms_active: !before.is_lms_active })
      .eq("id", tenant.id);
    expect(error).toBeNull();
    const after = await tenantRow(tenant.id);
    expect(after.name).toBe("Renamed by owner");
    expect(after.is_lms_active).toBe(!before.is_lms_active);
  });

  it("members and RBP admins cannot change the tenant or its module flags", async () => {
    const before = await tenantRow(tenant.id);
    for (const user of [tenant.employee, tenant.manager, rbpAdmin]) {
      const { error } = await user.client
        .from("tenants")
        .update({ name: "Hijacked", is_lms_active: !before.is_lms_active })
        .eq("id", tenant.id);
      if (error) expect(error.code).toBe("42501");
    }
    expect(await tenantRow(tenant.id)).toEqual(before);
  });

  it("the owner cannot change identifying columns", async () => {
    const before = await tenantRow(tenant.id);
    const { error } = await owner.client.from("tenants").update({ slug: "stolen-slug" }).eq("id", tenant.id);
    expect(error?.code).toBe("42501");
    expect(await tenantRow(tenant.id)).toEqual(before);
  });

  it("the owner cannot update another tenant", async () => {
    const before = await tenantRow(otherTenant.id);
    const { error } = await owner.client.from("tenants").update({ name: "Cross-tenant" }).eq("id", otherTenant.id);
    if (error) expect(error.code).toBe("42501");
    expect(await tenantRow(otherTenant.id)).toEqual(before);
  });
});

describe("tenants — insert and delete", () => {
  it("authenticated users cannot create tenants", async () => {
    const id = randomUUID();
    for (const user of [owner, tenant.admin]) {
      const { error } = await user.client.from("tenants").insert({ id, name: "Rogue", slug: `rogue-${id.slice(0, 8)}` });
      expect(error?.code).toBe("42501");
    }
    const { rows } = await db.query("SELECT 1 FROM public.tenants WHERE id = $1", [id]);
    expect(rows).toEqual([]);
  });

  it("authenticated users cannot delete their tenant", async () => {
    for (const user of [owner, tenant.admin]) {
      const { error } = await user.client.from("tenants").delete().eq("id", tenant.id);
      if (error) expect(error.code).toBe("42501");
    }
    expect(await tenantRow(tenant.id)).toBeDefined();
  });

  it("no FOR ALL policy remains on tenants", async () => {
    const { rows } = await db.query(
      "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenants' AND cmd = 'ALL'",
    );
    expect(rows).toEqual([]);
  });
});
