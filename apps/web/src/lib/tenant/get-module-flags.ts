import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/tenant-client";
import { toModuleFlags, type ModuleFlags } from "./module-flags";

// D35: module flags change only when the platform turns a module on or off,
// and every page reads them. They are cached per tenant for
// MODULE_FLAGS_REVALIDATE_SECONDS, under a tag that a change can revalidate at
// once (revalidateTag(moduleFlagsTag(id))). Callers pass the tenant id of the
// verified token; public.tenant_module_flags() is for prisma_app only.

export const MODULE_FLAGS_REVALIDATE_SECONDS = 60;

export function moduleFlagsTag(tenantId: string): string {
  return `tenant:${tenantId}:modules`;
}

async function readModuleFlags(tenantId: string): Promise<ModuleFlags> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM public.tenant_module_flags(${tenantId}::uuid)`;
  return toModuleFlags(rows[0] ?? null);
}

/** One read per request (layout and page share it), and one per tenant per minute across requests. */
export const getModuleFlags = cache(
  (tenantId: string): Promise<ModuleFlags> =>
    unstable_cache(() => readModuleFlags(tenantId), ["module-flags", tenantId], {
      tags: [moduleFlagsTag(tenantId)],
      revalidate: MODULE_FLAGS_REVALIDATE_SECONDS,
    })(),
);
