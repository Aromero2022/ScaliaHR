import { Text } from "@react-email/components";
import type { ResolvedBranding } from "../branding.js";
import type { EmailJob, Locale } from "../contract.js";
import { messagesFor } from "../messages.js";
import { Layout, paragraph } from "./Layout.js";

type Job<T extends EmailJob["template"]> = Extract<EmailJob, { template: T }>;

interface Props<T extends EmailJob["template"]> {
  job: Job<T>;
  locale: Locale;
  branding: ResolvedBranding;
}

export function invitationSubject(locale: Locale, branding: ResolvedBranding): string {
  const { m, t } = messagesFor(locale);
  return t(m.invitation.subject, { tenant: branding.tenantName });
}

export function Invitation({ job, locale, branding }: Props<"invitation">) {
  const { m, t } = messagesFor(locale);
  const { data } = job;
  const tenant = branding.tenantName;
  return (
    <Layout
      locale={locale}
      branding={branding}
      preview={invitationSubject(locale, branding)}
      heading={t(m.invitation.heading, { tenant })}
      action={{ url: data.acceptUrl, label: m.invitation.cta }}
    >
      <Text style={paragraph}>
        {data.inviteeName ? t(m.invitation.greeting, { name: data.inviteeName }) : m.invitation.greetingAnonymous}
      </Text>
      <Text style={paragraph}>
        {data.inviterName ? t(m.invitation.bodyWithInviter, { inviter: data.inviterName, tenant }) : t(m.invitation.body, { tenant })}
      </Text>
      <Text style={paragraph}>{t(m.invitation.expiry, { hours: data.expiresInHours })}</Text>
    </Layout>
  );
}

export function passwordResetSubject(locale: Locale, branding: ResolvedBranding): string {
  const { m, t } = messagesFor(locale);
  return t(m.password_reset.subject, { tenant: branding.tenantName });
}

export function PasswordReset({ job, locale, branding }: Props<"password_reset">) {
  const { m, t } = messagesFor(locale);
  return (
    <Layout
      locale={locale}
      branding={branding}
      preview={passwordResetSubject(locale, branding)}
      heading={m.password_reset.heading}
      action={{ url: job.data.resetUrl, label: m.password_reset.cta }}
    >
      <Text style={paragraph}>{t(m.password_reset.body, { tenant: branding.tenantName })}</Text>
      <Text style={paragraph}>{t(m.password_reset.expiry, { minutes: job.data.expiresInMinutes })}</Text>
      <Text style={paragraph}>{m.password_reset.notYou}</Text>
    </Layout>
  );
}

export function Notification({ job, locale, branding }: Props<"notification">) {
  const { m } = messagesFor(locale);
  const { data } = job;
  const paragraphs = data.body.split(/\n{2,}/);
  return (
    <Layout
      locale={locale}
      branding={branding}
      preview={data.title}
      heading={data.title}
      action={data.actionUrl ? { url: data.actionUrl, label: data.actionLabel ?? m.notification.cta } : undefined}
    >
      {paragraphs.map((p, i) => (
        <Text key={i} style={paragraph}>
          {p}
        </Text>
      ))}
    </Layout>
  );
}
