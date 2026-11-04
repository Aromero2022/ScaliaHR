import { z } from "zod";

// The job contract between producers (web) and the worker. No React imports
// here, so producers can use it without pulling in the templates.

export const EMAIL_QUEUE = "email.send";

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const HttpUrl = z.url({ protocol: /^https?$/ }).max(2048);
const ShortText = z.string().trim().min(1).max(120);

const Base = {
  tenantId: z.guid(),
  to: z.email().max(254),
  locale: z.enum(LOCALES).optional(),
};

export const InvitationJob = z.object({
  ...Base,
  template: z.literal("invitation"),
  data: z.object({
    acceptUrl: HttpUrl,
    inviteeName: ShortText.optional(),
    inviterName: ShortText.optional(),
    expiresInHours: z.number().int().min(1).max(720).default(72),
  }),
});

export const PasswordResetJob = z.object({
  ...Base,
  template: z.literal("password_reset"),
  data: z.object({
    resetUrl: HttpUrl,
    expiresInMinutes: z.number().int().min(5).max(1440).default(60),
  }),
});

export const NotificationJob = z.object({
  ...Base,
  template: z.literal("notification"),
  data: z
    .object({
      title: z.string().trim().min(1).max(150),
      body: z.string().trim().min(1).max(5000),
      actionUrl: HttpUrl.optional(),
      actionLabel: z.string().trim().min(1).max(60).optional(),
    })
    .refine((d) => !d.actionLabel || d.actionUrl, {
      message: "actionLabel needs actionUrl",
      path: ["actionLabel"],
    }),
});

export const EmailJobSchema = z.discriminatedUnion("template", [InvitationJob, PasswordResetJob, NotificationJob]);

export type EmailJob = z.infer<typeof EmailJobSchema>;
export type EmailJobInput = z.input<typeof EmailJobSchema>;
export type EmailTemplate = EmailJob["template"];
