import type { PgBoss } from "pg-boss";
import { QUEUES } from "./queues.js";

export async function registerHandlers(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.ping, async (jobs) => {
    for (const job of jobs) {
      console.log(`[worker] ${QUEUES.ping} ${job.id} done`);
    }
  });
}
