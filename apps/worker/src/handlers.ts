import { createSmtpTransport } from "@scaliahr/email";
import type { PgBoss } from "pg-boss";
import type { WorkerConfig } from "./config.js";
import { brandingFromDb, deliverEmail } from "./email.js";
import { QUEUES } from "./queues.js";

export async function registerHandlers(boss: PgBoss, config: WorkerConfig): Promise<void> {
  await boss.work(QUEUES.ping, async (jobs) => {
    for (const job of jobs) {
      console.log(`[worker] ${QUEUES.ping} ${job.id} done`);
    }
  });

  const transport = createSmtpTransport(config.email.smtp);
  boss.on("stopped", () => void transport.close());
  const deps = {
    branding: brandingFromDb(boss),
    transport,
    from: config.email.from,
    appBaseUrl: config.email.appBaseUrl,
  };
  await boss.work(QUEUES.email, async (jobs) => {
    for (const job of jobs) {
      // Log the outcome only: the payload carries addresses and links.
      const outcome = await deliverEmail(job.data, deps);
      console.log(`[worker] ${QUEUES.email} ${job.id} ${outcome}`);
    }
  });
}
