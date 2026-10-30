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

      const bizUserId = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM public.users WHERE auth_uid = ${user.id}::uuid LIMIT 1`
      );

      if (bizUserId.length > 0) {
        await tx.$executeRaw(
          Prisma.sql`
            WITH new_group AS (
              INSERT INTO public.permission_groups (tenant_id, name, description)
              VALUES (${tenant.id}::uuid, 'Administrators', 'Users with administrative access')
              RETURNING id
            ),
            new_role AS (
              INSERT INTO public.permission_roles (tenant_id, name, description, is_admin_role)
              VALUES (${tenant.id}::uuid, 'Owner', 'Tenant owner with full control', true)
              RETURNING id
            ),
            _perms AS (
              INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
              SELECT ${tenant.id}::uuid, r.id, p.key, p.act::public.rbp_action
              FROM new_role r
              CROSS JOIN (VALUES
                ('admin_center.access',    'view'),
                ('arco.manage',            'view'),
                ('admin.manage_roles',     'edit'),
                ('admin.manage_config',    'edit'),
                ('admin.view_audit_logs',  'view'),
                ('admin.manage_tenant',    'edit'),
                ('admin.manage_billing',   'edit')
              ) AS p(key, act)
            ),
            _grant AS (
              INSERT INTO public.role_grants (tenant_id, role_id, granted_group_id, target_population)
              SELECT ${tenant.id}::uuid, r.id, g.id, 'all'::public.target_population_type
              FROM new_role r, new_group g
            )
            INSERT INTO public.group_members (tenant_id, group_id, user_id)
            SELECT ${tenant.id}::uuid, g.id, ${bizUserId[0].id}::uuid
            FROM new_group g
          `
        );
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
