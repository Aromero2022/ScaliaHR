import { randomUUID } from "node:crypto";
import type pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationEnv } from "./env";

export interface TestUser {
  authId: string;
  userId: string;
  email: string;
  token: string;
  client: SupabaseClient;
}

export interface TestTenant {
  id: string;
  slug: string;
  admin: TestUser;
  manager: TestUser;
  employee: TestUser;
  adminGroupId: string;
  adminRoleId: string;
  employeeGroupId: string;
  employeeRoleId: string;
}

type Role = "admin" | "manager" | "employee";

/**
 * Builds isolated tenants with real auth users for the integration suites.
 * Nothing here depends on demo data; cleanup() removes everything it created.
 */
export class TestWorld {
  readonly svc: SupabaseClient;
  readonly anon: SupabaseClient;
  private readonly password = `It-${randomUUID()}`;
  private readonly authIds: string[] = [];
  private readonly tenantIds: string[] = [];

  constructor(
    private readonly env: IntegrationEnv,
    private readonly db: pg.Client,
  ) {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    this.svc = createClient(env.supabaseUrl, env.serviceKey, options);
    this.anon = createClient(env.supabaseUrl, env.anonKey, options);
  }

  clientFor(token: string): SupabaseClient {
    return createClient(this.env.supabaseUrl, this.env.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async createAuthUser(): Promise<{ authId: string; email: string }> {
    const email = `it-${randomUUID()}@example.test`;
    const { data, error } = await this.svc.auth.admin.createUser({
      email,
      password: this.password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    this.authIds.push(data.user.id);
    return { authId: data.user.id, email };
  }

  // A throwaway client per sign-in: supabase-js keeps the session in memory and
  // would otherwise send every later "anon" request with this user's token.
  async signIn(email: string): Promise<string> {
    const client = createClient(this.env.supabaseUrl, this.env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password: this.password,
    });
    if (error || !data.session) {
      throw new Error(`signInWithPassword failed for ${email}: ${error?.message}`);
    }
    return data.session.access_token;
  }

  async userWithoutTenant(): Promise<Omit<TestUser, "userId">> {
    const { authId, email } = await this.createAuthUser();
    const token = await this.signIn(email);
    return { authId, email, token, client: this.clientFor(token) };
  }

  /** A signed-in member of an existing tenant with the given membership app_role. */
  async addMember(tenantId: string, appRole: string): Promise<TestUser> {
    const { authId, email } = await this.createAuthUser();
    const userId = randomUUID();
    await this.db.query(
      `INSERT INTO public.users (id, tenant_id, auth_uid, email, first_name, last_name, status)
       VALUES ($1, $2, $3, $4, $5, 'Integration', 'ACTIVE')`,
      [userId, tenantId, authId, email, appRole],
    );
    await this.db.query(
      `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
       VALUES ($1, $2, $3, true)`,
      [authId, tenantId, appRole],
    );
    await this.db.query(
      "INSERT INTO public.user_settings (user_id, active_tenant_id) VALUES ($1, $2)",
      [authId, tenantId],
    );
    const token = await this.signIn(email);
    return { authId, userId, email, token, client: this.clientFor(token) };
  }

  /**
   * admin: member of an "Admins" group granted an is_admin_role role (target all).
   * manager/employee: members of an "Employees" group granted a non-admin role
   * (target self); employee reports to manager in ec_job_information.
   * activeTenantSetting=false leaves user_settings empty so the hook must fall
   * back to the first active membership.
   */
  async createTenant(options: { activeTenantSetting?: boolean } = {}): Promise<TestTenant> {
    const activeTenantSetting = options.activeTenantSetting ?? true;
    const id = randomUUID();
    const slug = `it-${id.slice(0, 8)}`;
    this.tenantIds.push(id);
    await this.db.query(
      `INSERT INTO public.tenants (id, name, slug, is_ec_active, is_pmgm_active, is_tih_active)
       VALUES ($1, $2, $3, true, true, true)`,
      [id, `Integration ${slug}`, slug],
    );

    const users = {} as Record<Role, Omit<TestUser, "token" | "client">>;
    for (const role of ["admin", "manager", "employee"] as const) {
      const { authId, email } = await this.createAuthUser();
      const userId = randomUUID();
      await this.db.query(
        `INSERT INTO public.users (id, tenant_id, auth_uid, email, first_name, last_name, status)
         VALUES ($1, $2, $3, $4, $5, 'Integration', 'ACTIVE')`,
        [userId, id, authId, email, role],
      );
      await this.db.query(
        `INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
         VALUES ($1, $2, $3, true)`,
        [authId, id, role === "admin" ? "admin" : "member"],
      );
      if (activeTenantSetting) {
        await this.db.query(
          "INSERT INTO public.user_settings (user_id, active_tenant_id) VALUES ($1, $2)",
          [authId, id],
        );
      }
      users[role] = { authId, userId, email };
    }

    // The admin gets no job row: rls-isolation's generic fixtures attach their
    // effective-dated rows to the admin, and the EXCLUDE constraints forbid overlaps.
    for (const [role, title, managerId] of [
      ["manager", "Team Manager", null],
      ["employee", "Analyst", users.manager.userId],
    ] as const) {
      await this.db.query(
        `INSERT INTO public.ec_job_information (tenant_id, user_id, start_date, job_title, manager_id)
         VALUES ($1, $2, DATE '2026-01-01', $3, $4)`,
        [id, users[role].userId, title, managerId],
      );
    }

    const adminGroupId = randomUUID();
    const employeeGroupId = randomUUID();
    const adminRoleId = randomUUID();
    const employeeRoleId = randomUUID();
    await this.db.query(
      `INSERT INTO public.permission_groups (id, tenant_id, name)
       VALUES ($1, $3, 'Admins'), ($2, $3, 'Employees')`,
      [adminGroupId, employeeGroupId, id],
    );
    await this.db.query(
      `INSERT INTO public.permission_roles (id, tenant_id, name, is_admin_role)
       VALUES ($1, $3, 'Tenant Admin', true), ($2, $3, 'Employee Self Service', false)`,
      [adminRoleId, employeeRoleId, id],
    );
    await this.db.query(
      `INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
       VALUES ($1, $2, 'employee_profile', 'view'), ($1, $3, 'employee_profile', 'view'),
              ($1, $2, 'employee_profile', 'edit')`,
      [id, adminRoleId, employeeRoleId],
    );
    await this.db.query(
      `INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population)
       VALUES ($1, $2, $3, 'all'), ($1, $4, $5, 'self')`,
      [id, adminRoleId, adminGroupId, employeeRoleId, employeeGroupId],
    );
    await this.db.query(
      `INSERT INTO public.group_members (tenant_id, group_id, user_id)
       VALUES ($1, $2, $3), ($1, $4, $5), ($1, $4, $6)`,
      [id, adminGroupId, users.admin.userId, employeeGroupId, users.manager.userId, users.employee.userId],
    );

    const signedIn = {} as Record<Role, TestUser>;
    for (const role of ["admin", "manager", "employee"] as const) {
      const token = await this.signIn(users[role].email);
      signedIn[role] = { ...users[role], token, client: this.clientFor(token) };
    }

    return {
      id,
      slug,
      ...signedIn,
      adminGroupId,
      adminRoleId,
      employeeGroupId,
      employeeRoleId,
    };
  }

  async cleanup(): Promise<void> {
    if (this.tenantIds.length > 0) {
      const { rows } = await this.db.query<{ table_name: string }>(`
        SELECT c.relname::text AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
          AND a.attname = 'tenant_id' AND NOT a.attisdropped`);
      await this.db.query("BEGIN");
      try {
        await this.db.query("SET LOCAL session_replication_role = replica");
        for (const { table_name } of rows) {
          await this.db.query(`DELETE FROM public."${table_name}" WHERE tenant_id = ANY($1::uuid[])`, [
            this.tenantIds,
          ]);
        }
        await this.db.query("DELETE FROM public.tenants WHERE id = ANY($1::uuid[])", [this.tenantIds]);
        await this.db.query("COMMIT");
      } catch (error) {
        await this.db.query("ROLLBACK");
        throw error;
      }
    }
    for (const authId of this.authIds) {
      await this.svc.auth.admin.deleteUser(authId);
    }
  }
}

export function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}
