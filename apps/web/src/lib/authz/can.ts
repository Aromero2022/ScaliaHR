import { cache } from "react";
import { Prisma, prisma } from "@/lib/db/tenant-client";
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

type ContextRow = {
  tenant: Record<string, unknown> | null;
  grants: GrantRow[];
  permissions: PermissionRow[];
};

// D47: one call to public.rbp_context(), which only prisma_app may execute.
// It used to read role_grants and group_members as authenticated; those are
// now limited to the caller's own rows, and can() answers for any user id.
async function loadPermissionContext(
  userId: string,
  tenantId: string,
): Promise<PermissionContext> {
  const rows = await prisma.$queryRaw<{ ctx: ContextRow }[]>(Prisma.sql`
    SELECT public.rbp_context(${tenantId}::uuid, ${userId}::uuid) AS ctx
  `);
  const row = rows[0]?.ctx;
  const tenant = row?.tenant ?? null;
  const grants = row?.grants ?? [];
  const permissions = row?.permissions ?? [];
  const moduleFlags: Record<string, boolean> = {};
  for (const [prefix, col] of Object.entries(PERMISSION_MODULE_MAP)) {
    moduleFlags[prefix] = tenant?.[col] === true;
  }

  return { tenantId, moduleFlags, grants, permissions };
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
  const populations = new Set(ctx.grants.filter((g) => permittedRoleIds.has(g.role_id)).map((g) => g.target_population));

  // D47: the union of every population that grants the permission, like the
  // RLS policies (rbp_visible_user_ids). Before, the first direct_reports or
  // same_department grant decided alone, so a manager who was also an HR
  // administrator (all) could be refused depending on the grants' order.
  if (populations.has("all")) return { allowed: true };
  if (populations.has("self") && targetUserId === userId) return { allowed: true };
  for (const population of ["direct_reports", "same_department"] as const) {
    if (!populations.has(population)) continue;
    // The membership comes from public.rbp_target_in_population(), the same
    // population the policies read; only prisma_app may execute it.
    const rows = await prisma.$queryRaw<{ match: boolean }[]>(Prisma.sql`
      SELECT public.rbp_target_in_population(${tenantId}::uuid, ${userId}::uuid, ${targetUserId}::uuid, ${population}) AS match
    `);
    if (rows[0]?.match) return { allowed: true };
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
