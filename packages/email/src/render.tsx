import { render } from "@react-email/components";
import type { ReactElement } from "react";
import { resolveBranding, type TenantBranding } from "./branding.js";
import type { EmailJob, Locale } from "./contract.js";
import { Invitation, invitationSubject, Notification, PasswordReset, passwordResetSubject } from "./templates/index.js";
import { assertAppUrl } from "./urls.js";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RenderOptions {
  /** Origin every link must belong to, e.g. http://localhost:3000. */
  appBaseUrl: string;
}

/**
 * Renders a validated job with the tenant's branding. Locale: the job's, then
 * the tenant's platform locale, then Spanish.
 */
export async function renderEmail(job: EmailJob, tenant: TenantBranding | null, options: RenderOptions): Promise<RenderedEmail> {
  const branding = resolveBranding(tenant);
  const locale: Locale = job.locale ?? branding.locale ?? "es";
  let element: ReactElement;
  let subject: string;

  switch (job.template) {
    case "invitation": {
      const safe = { ...job, data: { ...job.data, acceptUrl: assertAppUrl(job.data.acceptUrl, options.appBaseUrl) } };
      element = <Invitation job={safe} locale={locale} branding={branding} />;
      subject = invitationSubject(locale, branding);
      break;
    }
    case "password_reset": {
      const safe = { ...job, data: { ...job.data, resetUrl: assertAppUrl(job.data.resetUrl, options.appBaseUrl) } };
      element = <PasswordReset job={safe} locale={locale} branding={branding} />;
      subject = passwordResetSubject(locale, branding);
      break;
    }
    case "notification": {
      const actionUrl = job.data.actionUrl ? assertAppUrl(job.data.actionUrl, options.appBaseUrl) : undefined;
      const safe = { ...job, data: { ...job.data, actionUrl } };
      element = <Notification job={safe} locale={locale} branding={branding} />;
      subject = job.data.title;
      break;
    }
  }

  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
