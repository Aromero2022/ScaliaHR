import { PgBoss } from "pg-boss";
import { EMAIL_QUEUE, EmailJobSchema, type EmailJobInput } from "@scaliahr/email/contract";

// Server-only (D20): connects as email_enqueuer, which can insert email.send jobs
// and nothing else. Same no-DDL options as the worker (D17); the producer also
// skips supervision and instance registration, which it has no privileges for.
const PRODUCER_OPTIONS = {
  schema: "pgboss",
  migrate: false,
  createSchema: false,
  schedule: false,
  reindex: false,
  persistQueueStats: false,
  supervise: false,
  registerInstance: false,
} as const;

export interface EmailQueue {
  /** Validates the job with zod and enqueues it; the worker renders and sends it. */
  enqueue(input: EmailJobInput): Promise<string>;
  stop(): Promise<void>;
}

export function createEmailQueue(connectionString: string): EmailQueue {
  let started: Promise<PgBoss> | null = null;

  function boss(): Promise<PgBoss> {
    started ??= (async () => {
      const instance = new PgBoss({ connectionString, ...PRODUCER_OPTIONS });
      instance.on("error", (error: Error) => console.error(`[email] pg-boss error: ${error.message}`));
      await instance.start();
      return instance;
    })().catch((error: unknown) => {
      started = null;
      throw error;
    });
    return started;
  }

  return {
    async enqueue(input) {
      const job = EmailJobSchema.parse(input);
      const id = await (await boss()).send(EMAIL_QUEUE, job);
      if (!id) throw new Error("the email job was not enqueued");
      return id;
    },
    async stop() {
      const current = started;
      started = null;
      if (current) await (await current).stop({ graceful: false });
    },
  };
}

let shared: EmailQueue | null = null;

export async function enqueueEmail(input: EmailJobInput): Promise<string> {
  const url = process.env.EMAIL_ENQUEUE_DATABASE_URL;
  if (!url) throw new Error("EMAIL_ENQUEUE_DATABASE_URL is not set");
  shared ??= createEmailQueue(url);
  return shared.enqueue(input);
}
