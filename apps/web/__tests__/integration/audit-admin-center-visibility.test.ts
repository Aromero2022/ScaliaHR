import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { integrationEnv } from "./helpers/env";
import { TestWorld, type TestTenant } from "./helpers/world";

/**
 * Reproduces the "Sin entradas de auditoría" bug in Admin Center.
 *
 * Root cause: login, MFA-enroll, and MFA-verify never called writeAuditLog(),
 * so the audit_logs table stayed empty for auth events.  The admin-center
 * query returned zero rows and rendered the empty-state message.
 *
 * Secondary: the test helper's createTenant() did not grant
 * admin.view_audit_logs, so even if entries existed the RBP can() check
 * would have hidden the audit section.
 */

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const world = new TestWorld(env, db);

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await world.createTenant();
});

afterAll(async () => {
  try {
    await world.cleanup();
  } finally {
    await db.end();
  }
});

describe("audit-admin-center-visibility", () => {
  describe("write: auth events produce audit entries", () => {
    it("AUTH_LOGIN entries exist after signIn during tenant setup", async () => {
      const { rows } = await db.query(
        "SELECT user_id, action FROM public.audit_logs WHERE tenant_id = $1 AND action = 'AUTH_LOGIN'",
        [tenant.id],
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("AUTH_LOGIN entries are attributed to the user who signed in", async () => {
      const { rows } = await db.query(
        `SELECT user_id FROM public.audit_logs
         WHERE tenant_id = $1 AND action = 'AUTH_LOGIN' AND user_id = $2`,
        [tenant.id, tenant.admin.userId],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe("read: admin-center query returns entries", () => {
    it("tenant admin reads audit entries through the same PostgREST query as page.tsx", async () => {
      const { data, error } = await tenant.admin.client
        .from("audit_logs")
        .select("action, created_at, entity, user:users(first_name, last_name)")
        .order("created_at", { ascending: false })
        .limit(5);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      expect(data!.some((r: { action: string }) => r.action === "AUTH_LOGIN")).toBe(true);
    });

    it("employee cannot read audit entries", async () => {
      const { data } = await tenant.employee.client
        .from("audit_logs")
        .select("id")
        .eq("action", "AUTH_LOGIN");
      expect(data ?? []).toEqual([]);
    });
  });

  describe("RBP: admin.view_audit_logs permission is granted to tenant admin role", () => {
    it("admin role includes admin.view_audit_logs:view", async () => {
      const { rows } = await db.query(
        `SELECT 1 FROM public.role_permissions
         WHERE tenant_id = $1 AND role_id = $2
           AND permission_key = 'admin.view_audit_logs' AND action = 'view'`,
        [tenant.id, tenant.adminRoleId],
      );
      expect(rows).toHaveLength(1);
    });
  });
});
