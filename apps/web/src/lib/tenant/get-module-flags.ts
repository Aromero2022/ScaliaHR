"use server";

import { createClient } from "@/lib/supabase/server";
import { MODULE_FLAGS_SELECT, toModuleFlags, type ModuleFlags } from "./module-flags";

export async function getModuleFlags(
  tenantId: string
): Promise<ModuleFlags> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("tenants")
    .select(MODULE_FLAGS_SELECT)
    .eq("id", tenantId)
    .single();

  return toModuleFlags(data as Record<string, unknown> | null);
}
