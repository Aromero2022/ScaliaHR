import { EmailJobSchema, renderEmail, type EmailTransport, type TenantBranding } from "@scaliahr/email";
import type { PgBoss } from "pg-boss";

export type BrandingLookup = (tenantId: string) => Promise<TenantBranding | null>;

export interface EmailDeps {
  branding: BrandingLookup;
  transport: EmailTransport;
  from: string;
  appBaseUrl: string;
}

/**
 * Validates one email.send job, renders it with the tenant's branding and hands
 * it to the transport. A tenant that does not exist or is suspended (D21) gets
 * no email: the job completes as "dropped" instead of retrying.
 */
export async function deliverEmail(data: unknown, deps: EmailDeps): Promise<"sent" | "dropped"> {
  const job = EmailJobSchema.parse(data);
  const tenant = await deps.branding(job.tenantId);
  if (!tenant) return "dropped";
  const email = await renderEmail(job, tenant, { appBaseUrl: deps.appBaseUrl });
  await deps.transport.send({ from: deps.from, to: job.to, ...email });
  return "sent";
}

/** Reads branding through public.email_branding (D20), the only public object worker_app can use. */
export function brandingFromDb(boss: PgBoss): BrandingLookup {
  return async (tenantId) => {
    const { rows } = await boss.getDb().executeSql(
      "SELECT tenant_name, logo_url, primary_color, locale FROM public.email_branding($1)",
      [tenantId],
    );
    const row = rows[0] as
      | { tenant_name: string; logo_url: string | null; primary_color: string | null; locale: string | null }
      | undefined;
    if (!row) return null;
    return {
      tenantName: row.tenant_name,
      logoUrl: row.logo_url,
      primaryColor: row.primary_color,
      locale: row.locale,
    };
  };
}
