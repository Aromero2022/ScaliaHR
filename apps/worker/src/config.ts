import { z } from "zod";

const EnvSchema = z.object({
  WORKER_DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/[^\s]+$/, "must be a postgres:// connection URL"),
  // SMTP adapter (D20): Mailpit of Supabase local. Resend replaces it in Phase 23.
  SMTP_HOST: z.string().trim().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  EMAIL_FROM: z.email(),
  // Origin of the web app: links in emails must stay on it or its tenant subdomains.
  APP_BASE_URL: z.url({ protocol: /^https?$/ }),
});

export interface WorkerConfig {
  databaseUrl: string;
  email: {
    smtp: { host: string; port: number };
    from: string;
    appBaseUrl: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Report which variable is wrong, never its value: the URL carries a password.
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid worker environment: ${problems}`);
  }
  const { data } = parsed;
  return {
    databaseUrl: data.WORKER_DATABASE_URL,
    email: {
      smtp: { host: data.SMTP_HOST, port: data.SMTP_PORT },
      from: data.EMAIL_FROM,
      appBaseUrl: data.APP_BASE_URL,
    },
  };
}
