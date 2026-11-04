import { z } from "zod";

const EnvSchema = z.object({
  WORKER_DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/[^\s]+$/, "must be a postgres:// connection URL"),
});

export interface WorkerConfig {
  databaseUrl: string;
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
  return { databaseUrl: parsed.data.WORKER_DATABASE_URL };
}
