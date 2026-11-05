import { createSmtpTransport, EmailJobSchema } from "@scaliahr/email";
import type { PgBoss } from "pg-boss";
import type { WorkerConfig } from "./config.js";
import { exportTenant, TenantExportJob } from "./backup.js";
import { brandingFromDb, deliverEmail } from "./email.js";
import { errorFields, log } from "./log.js";
import { QUEUES } from "./queues.js";

export async function registerHandlers(boss: PgBoss, config: WorkerConfig): Promise<void> {
  await boss.work(QUEUES.ping, async (jobs) => {
    for (const job of jobs) {
      log("info", "job.completed", { queue: QUEUES.ping, jobId: job.id });
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
      const tenantId = EmailJobSchema.safeParse(job.data).data?.tenantId;
      try {
        const outcome = await deliverEmail(job.data, deps);
        log("info", "job.completed", { queue: QUEUES.email, jobId: job.id, tenantId, outcome });
      } catch (error) {
        log("error", "job.failed", { queue: QUEUES.email, jobId: job.id, tenantId, error: errorFields(error) });
        throw error;
      }
    }
  });

  // One job per call (default batch size), so the export becomes the job's output.
  await boss.work(QUEUES.tenantExport, async ([job]) => {
    const { tenantId } = TenantExportJob.parse(job.data);
    try {
      const result = await exportTenant(boss.getDb(), tenantId, config.backupDir);
      log("info", "job.completed", { queue: QUEUES.tenantExport, jobId: job.id, tenantId, rows: result.rows });
      return result;
    } catch (error) {
      log("error", "job.failed", { queue: QUEUES.tenantExport, jobId: job.id, tenantId, error: errorFields(error) });
      throw error;
    }
  });
}
