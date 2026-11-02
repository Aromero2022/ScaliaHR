import { cache } from "react";
import { Prisma, withTenant } from "@/lib/db/tenant-client";
import type { PrismaClient } from "@/lib/db/tenant-client";
import { getClaims } from "@/lib/supabase/claims";

type RbpAction = "view" | "edit";

type CanResult = {
  allowed: boolean;
  reason?: string;
};

export type { RbpAction, CanResult };

export const PERMISSION_MODULE_MAP: Record<string, string> = {
  ec: "is_ec_active",
  pmgm: "is_pmgm_active",
  tih: "is_tih_active",
  lms: "is_lms_active",
  sdm: "is_sdm_active",
  rcm: "is_rcm_active",
  onb: "is_onb_active",
  comp: "is_comp_active",
  wfa: "is_wfa_active",
  wfp: "is_wfp_active",
  tme: "is_tme_active",
  pos_mgmt: "is_pos_mgmt_active",
};

// --- Permission context: loaded once per request via React.cache() ---

type GrantRow = {
  role_id: string;
  target_population: string;
};

type PermissionRow = {
  role_id: string;
  permission_key: string;
  action: string;
  field_key: string | null;
};

type PermissionContext = {
  tenantId: string;
  moduleFlags: Record<string, boolean>;
  grants: GrantRow[];
  permissions: PermissionRow[];
};

async function loadPermissionContext(
  userId: string,
  tenantId: string,
): Promise<PermissionContext> {
  return withTenant({ tenantId }, async (tx) => {
    const [flagRows, grants, permissions] = await Promise.all([
      tx.$queryRaw<Record<string, boolean>[]>(Prisma.sql`
        SELECT * FROM public.tenants WHERE id = ${tenantId}::uuid
      `),
      tx.$queryRaw<GrantRow[]>(Prisma.sql`
        SELECT rg.role_id, rg.target_population::text
        FROM public.role_grants rg
        JOIN public.group_members gm ON gm.group_id = rg.granted_group_id
                                     AND gm.tenant_id = rg.tenant_id
        WHERE gm.user_id = ${userId}::uuid
          AND rg.tenant_id = ${tenantId}::uuid
      `),
      tx.$queryRaw<PermissionRow[]>(Prisma.sql`
        SELECT rp.role_id, rp.permission_key, rp.action::text, rp.field_key
        FROM public.role_permissions rp
        WHERE rp.tenant_id = ${tenantId}::uuid
          AND rp.role_id IN (
            SELECT rg.role_id
            FROM public.role_grants rg
            JOIN public.group_members gm ON gm.group_id = rg.granted_group_id
                                         AND gm.tenant_id = rg.tenant_id
            WHERE gm.user_id = ${userId}::uuid
              AND rg.tenant_id = ${tenantId}::uuid
          )
      `),
    ]);

    const tenantRow = flagRows[0] ?? {};
    const moduleFlags: Record<string, boolean> = {};
    for (const [prefix, col] of Object.entries(PERMISSION_MODULE_MAP)) {
      moduleFlags[prefix] = (tenantRow as Record<string, unknown>)[col] === true;
    }

    return { tenantId, moduleFlags, grants, permissions };
  });
}

const loadPermissionContextCached = cache(loadPermissionContext);

// --- Evaluation against preloaded context ---

function evaluateFromContext(
  ctx: PermissionContext,
  userId: string,
  permissionKey: string,
  action: RbpAction,
  fieldKey?: string,
): CanResult {
  const modulePrefix = permissionKey.split(".")[0];
  if (PERMISSION_MODULE_MAP[modulePrefix] && !ctx.moduleFlags[modulePrefix]) {
    return { allowed: false, reason: "module_inactive" };
  }

  if (ctx.grants.length === 0) {
    return { allowed: false, reason: "no_group_membership" };
  }

  const matchingPerms = ctx.permissions.filter(
    (p) =>
      p.permission_key === permissionKey &&
      p.action === action &&
      (fieldKey ? p.field_key === fieldKey : true),
  );

  if (matchingPerms.length === 0) {
    return { allowed: false, reason: "no_permission" };
  }

  const permittedRoleIds = new Set(matchingPerms.map((p) => p.role_id));
  const hasAny = ctx.grants.some((g) => permittedRoleIds.has(g.role_id));
  return hasAny
    ? { allowed: true }
    : { allowed: false, reason: "no_matching_grant" };
}

async function evaluateTargetPopulation(
  ctx: PermissionContext,
  userId: string,
  tenantId: string,
  permissionKey: string,
  action: RbpAction,
  targetUserId: string,
  fieldKey?: string,
): Promise<CanResult> {
  const modulePrefix = permissionKey.split(".")[0];
  if (PERMISSION_MODULE_MAP[modulePrefix] && !ctx.moduleFlags[modulePrefix]) {
    return { allowed: false, reason: "module_inactive" };
  }

  if (ctx.grants.length === 0) {
    return { allowed: false, reason: "no_group_membership" };
  }

  const matchingPerms = ctx.permissions.filter(
    (p) =>
      p.permission_key === permissionKey &&
      p.action === action &&
      (fieldKey ? p.field_key === fieldKey : true),
  );

  if (matchingPerms.length === 0) {
    return { allowed: false, reason: "no_permission" };
  }

  const permittedRoleIds = new Set(matchingPerms.map((p) => p.role_id));

  for (const grant of ctx.grants) {
    if (!permittedRoleIds.has(grant.role_id)) continue;

    switch (grant.target_population) {
      case "all":
        return { allowed: true };

      case "self":
        if (targetUserId === userId) return { allowed: true };
        break;

      case "same_department":
      case "direct_reports":
        // These require a DB query; use a single withTenant call
        return withTenant({ tenantId }, async (tx) => {
          for (const g of ctx.grants) {
            if (!permittedRoleIds.has(g.role_id)) continue;

            if (g.target_population === "same_department") {
              const rows = await tx.$queryRaw<{ match: boolean }[]>(Prisma.sql`
                SELECT (a.department_id IS NOT NULL AND a.department_id = t.department_id) AS match
                FROM public.users a, public.users t
                WHERE a.id = ${userId}::uuid AND t.id = ${targetUserId}::uuid
              `);
              if (rows.length > 0 && rows[0].match) return { allowed: true };
            }

            if (g.target_population === "direct_reports") {
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
            }
          }
          return { allowed: false, reason: "target_population_mismatch" };
        });
    }
  }

  return { allowed: false, reason: "target_population_mismatch" };
}

// --- Public API ---

export async function can(
  userId: string,
  permissionKey: string,
  action: RbpAction,
  targetUserId?: string,
  fieldKey?: string,
): Promise<CanResult> {
  const claims = await getClaims();
  if (!claims?.tenantId) {
    return { allowed: false, reason: "no_tenant" };
  }

  const ctx = await loadPermissionContextCached(userId, claims.tenantId);

  if (!targetUserId || targetUserId === userId) {
    return evaluateFromContext(ctx, userId, permissionKey, action, fieldKey);
  }

  return evaluateTargetPopulation(
    ctx,
    userId,
    claims.tenantId,
    permissionKey,
    action,
    targetUserId,
    fieldKey,
  );
}

export async function canMany(
  userId: string,
  keys: string[],
  action: RbpAction,
): Promise<Map<string, CanResult>> {
  const claims = await getClaims();
  const results = new Map<string, CanResult>();

  if (!claims?.tenantId) {
    for (const key of keys) {
      results.set(key, { allowed: false, reason: "no_tenant" });
    }
    return results;
  }

  const ctx = await loadPermissionContextCached(userId, claims.tenantId);

  for (const key of keys) {
    results.set(key, evaluateFromContext(ctx, userId, key, action));
  }

  return results;
}
