"use server";

import { createClient } from "@/lib/supabase/server";
import { adminPrisma, Prisma } from "@/lib/db/admin-client";
import { createTenantSchema, type CreateTenantInput } from "@/lib/validations/tenant";
import { revalidatePath } from "next/cache";

export async function createTenant(input: CreateTenantInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const parsed = createTenantSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, slug, rfc, modules } = parsed.data;

  try {
    const result = await adminPrisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name,
          slug,
          domain: rfc || null,
          is_ec_active: modules.employee_central,
          is_rcm_active: modules.recruiting,
          is_pmgm_active: modules.performance,
          is_lms_active: modules.lms,
        },
      });

      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role, is_active)
          VALUES (${user.id}::uuid, ${tenant.id}::uuid, 'owner', true)
        `
      );

      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO public.user_settings (user_id, active_tenant_id)
          VALUES (${user.id}::uuid, ${tenant.id}::uuid)
          ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id
        `
      );

      const tid = tenant.id;

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO public.permission_roles (tenant_id, name, description, is_admin_role)
        VALUES
          (${tid}::uuid, 'Owner',                   'Tenant owner with full control',                        true),
          (${tid}::uuid, 'HR Administrator',        'Full access to all HR modules and configuration',      true),
          (${tid}::uuid, 'Employee (Self-Service)', 'View own profile, goals, feedback and skills',          false),
          (${tid}::uuid, 'Manager',                 'View and manage direct reports',                        false)
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO public.permission_groups (tenant_id, name, description)
        VALUES
          (${tid}::uuid, 'All Administrators', 'Users with HR admin access'),
          (${tid}::uuid, 'All Employees',      'Every active employee in the tenant'),
          (${tid}::uuid, 'All Managers',       'Employees with direct reports')
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
        SELECT ${tid}::uuid, pr.id, p.key, p.act::public.rbp_action
        FROM public.permission_roles pr
        CROSS JOIN (VALUES
          ('admin_center.access',    'view'),
          ('arco.manage',            'view'),
          ('admin.manage_roles',     'edit'),
          ('admin.manage_config',    'edit'),
          ('admin.view_audit_logs',  'view'),
          ('ec.manage_employees',    'view'),
          ('ec.manage_employees',    'edit'),
          ('ec.manage_positions',    'edit'),
          ('ec.manage_org_structure','edit'),
          ('pmgm.manage_goal_plans', 'edit'),
          ('sdm.manage_succession',  'edit'),
          ('tih.ontology',           'view'),
          ('tih.ontology',           'edit'),
          ('tih.job_requirements',   'view'),
          ('tih.job_requirements',   'edit'),
          ('tih.employee_skills',    'view'),
          ('tih.employee_skills',    'edit')
        ) AS p(key, act)
        WHERE pr.tenant_id = ${tid}::uuid AND pr.name IN ('Owner', 'HR Administrator')
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
        SELECT ${tid}::uuid, pr.id, p.key, p.act::public.rbp_action
        FROM public.permission_roles pr
        CROSS JOIN (VALUES
          ('admin.manage_tenant',  'edit'),
          ('admin.manage_billing', 'edit')
        ) AS p(key, act)
        WHERE pr.tenant_id = ${tid}::uuid AND pr.name = 'Owner'
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
        SELECT ${tid}::uuid, pr.id, p.key, p.act::public.rbp_action
        FROM public.permission_roles pr
        CROSS JOIN (VALUES
          ('ec.view_own_profile',  'view'),
          ('ec.view_org_chart',    'view'),
          ('pmgm.view_own_goals',  'view'),
          ('pmgm.view_own_goals',  'edit'),
          ('pmgm.give_feedback',   'edit'),
          ('lms.access',           'view'),
          ('tih.ontology',         'view'),
          ('tih.employee_skills',  'view'),
          ('tih.employee_skills',  'edit')
        ) AS p(key, act)
        WHERE pr.tenant_id = ${tid}::uuid AND pr.name = 'Employee (Self-Service)'
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
        SELECT ${tid}::uuid, pr.id, p.key, p.act::public.rbp_action
        FROM public.permission_roles pr
        CROSS JOIN (VALUES
          ('ec.view_team_profiles',    'view'),
          ('pmgm.manage_team_goals',   'edit'),
          ('pmgm.view_team_feedback',  'view'),
          ('sdm.nominate_successors',  'edit'),
          ('tih.ontology',             'view'),
          ('tih.job_requirements',     'view'),
          ('tih.employee_skills',      'view'),
          ('tih.employee_skills',      'edit'),
          ('tih.manager_assessment',   'edit')
        ) AS p(key, act)
        WHERE pr.tenant_id = ${tid}::uuid AND pr.name = 'Manager'
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population)
        SELECT ${tid}::uuid, pr.id, pg.id, 'all'::public.target_population_type
        FROM public.permission_roles pr, public.permission_groups pg
        WHERE pr.tenant_id = ${tid}::uuid AND pr.name IN ('Owner', 'HR Administrator')
          AND pg.tenant_id = ${tid}::uuid AND pg.name = 'All Administrators'
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population)
        SELECT ${tid}::uuid, pr.id, pg.id, 'self'::public.target_population_type
        FROM public.permission_roles pr, public.permission_groups pg
        WHERE pr.tenant_id = ${tid}::uuid AND pr.name = 'Employee (Self-Service)'
          AND pg.tenant_id = ${tid}::uuid AND pg.name = 'All Employees'
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population)
        SELECT ${tid}::uuid, pr.id, pg.id, 'direct_reports'::public.target_population_type
        FROM public.permission_roles pr, public.permission_groups pg
        WHERE pr.tenant_id = ${tid}::uuid AND pr.name = 'Manager'
          AND pg.tenant_id = ${tid}::uuid AND pg.name = 'All Managers'
      `);

      const bizUserId = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM public.users WHERE auth_uid = ${user.id}::uuid LIMIT 1`
      );

      if (bizUserId.length > 0) {
        const uid = bizUserId[0].id;
        // Move user to the new tenant so composite FK (tenant_id, user_id) is satisfied
        await tx.$executeRaw(Prisma.sql`
          UPDATE public.users SET tenant_id = ${tid}::uuid WHERE id = ${uid}::uuid
        `);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO public.group_members (tenant_id, group_id, user_id)
          SELECT ${tid}::uuid, pg.id, ${uid}::uuid
          FROM public.permission_groups pg
          WHERE pg.tenant_id = ${tid}::uuid AND pg.name IN ('All Administrators', 'All Employees')
        `);
      }

      return tenant;
    });

    await supabase.auth.refreshSession();
    revalidatePath("/", "layout");

    return { success: true, tenantId: result.id };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error al crear el tenant";

    if (message.includes("unique") || message.includes("duplicate")) {
      return { error: "Ya existe una organización con ese slug" };
    }

    return { error: message };
  }
}
