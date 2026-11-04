import { createSmtpTransport } from "@scaliahr/email";
import type { PgBoss } from "pg-boss";
import type { WorkerConfig } from "./config.js";
import { exportTenant, TenantExportJob } from "./backup.js";
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

  // One job per call (default batch size), so the export becomes the job's output.
  await boss.work(QUEUES.tenantExport, async ([job]) => {
    const { tenantId } = TenantExportJob.parse(job.data);
    const result = await exportTenant(boss.getDb(), tenantId, config.backupDir);
    console.log(`[worker] ${QUEUES.tenantExport} ${job.id} ${result.rows} rows`);
    return result;
  });
}
