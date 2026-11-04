import type { PgBoss } from "pg-boss";
import { createBoss, type BossTuning } from "./boss.js";
import type { WorkerConfig } from "./config.js";
import { registerHandlers } from "./handlers.js";

export async function startWorker(config: WorkerConfig, tuning?: BossTuning): Promise<PgBoss> {
  const boss = createBoss(config.databaseUrl, tuning);
  boss.on("error", (error: Error) => console.error(`[worker] pg-boss error: ${error.message}`));
  await boss.start();
  await registerHandlers(boss);
  return boss;
}
