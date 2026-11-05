"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeError } from "@/lib/errors/safe-error";

export async function switchTenant(tenantId: string) {
  if (!tenantId || typeof tenantId !== "string") {
    return { error: "tenant_id inválido" };
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    return { error: "Formato de tenant_id inválido" };
  }

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
  if (!tenantId || typeof tenantId !== "string") {
    return { error: "tenant_id inválido" };
  }

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
