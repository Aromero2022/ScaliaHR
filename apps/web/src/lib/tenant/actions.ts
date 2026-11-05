"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeError } from "@/lib/errors/safe-error";
import { z } from "zod";
import { limitWrite } from "@/lib/rate-limit";

// Tenant ids of the seed are not RFC 4122 v4 (a0000000-…), so guid, not uuid.
const TenantId = z.guid("Formato de tenant_id inválido");

export async function switchTenant(tenantId: string) {
  const limited = await limitWrite();
  if (limited) return { error: limited };

  const parsed = TenantId.safeParse(tenantId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const { data: membership } = await supabase
    .from("user_tenant_memberships")
    .select("tenant_id, app_role, is_active")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .single();

  if (!membership || !membership.is_active) {
    return { error: "No tienes membresía activa en este tenant" };
  }

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: user.id, active_tenant_id: tenantId },
      { onConflict: "user_id" }
    );

  if (error) return { error: await safeError("tenant.switchTenant", error) };

  await supabase.auth.refreshSession();
  revalidatePath("/", "layout");
  return { success: true };
}

export async function revokeMembership(tenantId: string) {
  const limited = await limitWrite();
  if (limited) return { error: limited };

  const parsed = TenantId.safeParse(tenantId);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const { error } = await supabase
    .from("user_tenant_memberships")
    .update({ is_active: false })
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId);

  if (error) return { error: await safeError("tenant.revokeMembership", error) };

  const { data: settings } = await supabase
    .from("user_settings")
    .select("active_tenant_id")
    .eq("user_id", user.id)
    .single();

  if (settings?.active_tenant_id === tenantId) {
    await supabase
      .from("user_settings")
      .update({ active_tenant_id: null })
      .eq("user_id", user.id);
  }

  await supabase.auth.signOut();
  redirect("/login");
}
