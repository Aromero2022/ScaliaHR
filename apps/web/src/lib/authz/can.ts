import { Prisma, withTenant } from "@/lib/db/tenant-client";
import type { PrismaClient } from "@/lib/db/tenant-client";

type RbpAction = "view" | "edit";

type CanResult = {
  allowed: boolean;
  reason?: string;
};

const requestCache = new Map<string, CanResult>();

function cacheKey(
  userId: string,
  tenantId: string,
  permissionKey: string,
  action: RbpAction,
  targetUserId?: string,
  fieldKey?: string
): string {
  return `${userId}:${tenantId}:${permissionKey}:${action}:${targetUserId ?? ""}:${fieldKey ?? ""}`;
}

export async function can(
  userId: string,
  tenantId: string,
  permissionKey: string,
  action: RbpAction,
  targetUserId?: string,
  fieldKey?: string
): Promise<CanResult> {
  const key = cacheKey(userId, tenantId, permissionKey, action, targetUserId, fieldKey);
  const cached = requestCache.get(key);
  if (cached) return cached;

  const result = await evaluate(
    userId,
    tenantId,
    permissionKey,
    action,
    targetUserId,
    fieldKey
  );
  requestCache.set(key, result);
  return result;
}

export function clearCanCache() {
  requestCache.clear();
}

type GrantRow = {
  role_id: string;
  target_population: string;
};

async function findUserGrants(
  tx: PrismaClient,
  userId: string,
  tenantId: string,
): Promise<GrantRow[]> {
  return tx.$queryRaw<GrantRow[]>(Prisma.sql`
    SELECT rg.role_id, rg.target_population::text
    FROM public.role_grants rg
    JOIN public.group_members gm ON gm.group_id = rg.granted_group_id
                                 AND gm.tenant_id = rg.tenant_id
    WHERE gm.user_id = ${userId}::uuid
      AND rg.tenant_id = ${tenantId}::uuid
  `);
}

async function evaluate(
  userId: string,
  tenantId: string,
  permissionKey: string,
  action: RbpAction,
  targetUserId?: string,
  fieldKey?: string
): Promise<CanResult> {
  return withTenant({ tenantId }, async (tx) => {
    const grants = await findUserGrants(tx, userId, tenantId);

    if (grants.length === 0) {
      return { allowed: false, reason: "no_group_membership" };
    }

    const roleIds = grants.map((g) => g.role_id);

    const permissions = await tx.$queryRaw<{ role_id: string }[]>(
      fieldKey
        ? Prisma.sql`
            SELECT role_id FROM public.role_permissions
            WHERE role_id = ANY(${roleIds}::uuid[])
              AND permission_key = ${permissionKey}
              AND action = ${action}::"rbp_action"
              AND field_key = ${fieldKey}
          `
        : Prisma.sql`
            SELECT role_id FROM public.role_permissions
            WHERE role_id = ANY(${roleIds}::uuid[])
              AND permission_key = ${permissionKey}
              AND action = ${action}::"rbp_action"
          `
    );

    if (permissions.length === 0) {
      return { allowed: false, reason: "no_permission" };
    }

    const permittedRoleIds = new Set(permissions.map((p) => p.role_id));

    if (!targetUserId || targetUserId === userId) {
      const hasAny = grants.some((g) => permittedRoleIds.has(g.role_id));
      return hasAny
        ? { allowed: true }
        : { allowed: false, reason: "no_matching_grant" };
    }

    for (const grant of grants) {
      if (!permittedRoleIds.has(grant.role_id)) continue;

      switch (grant.target_population) {
        case "all":
          return { allowed: true };

        case "self":
          if (targetUserId === userId) return { allowed: true };
          break;

        case "same_department": {
          const rows = await tx.$queryRaw<{ match: boolean }[]>(Prisma.sql`
            SELECT (a.department_id IS NOT NULL AND a.department_id = t.department_id) AS match
            FROM public.users a, public.users t
            WHERE a.id = ${userId}::uuid AND t.id = ${targetUserId}::uuid
          `);
          if (rows.length > 0 && rows[0].match) return { allowed: true };
          break;
        }

        case "direct_reports": {
          const rows = await tx.$queryRaw<{ manager_id: string | null }[]>(
            Prisma.sql`
              SELECT manager_id FROM public.ec_job_information
              WHERE user_id = ${targetUserId}::uuid
                AND end_date IS NULL
              ORDER BY start_date DESC, sequence DESC
              LIMIT 1
            `
          );
          if (rows.length > 0 && rows[0].manager_id === userId) {
            return { allowed: true };
          }
          break;
        }
      }
    }

    return { allowed: false, reason: "target_population_mismatch" };
  });
}
