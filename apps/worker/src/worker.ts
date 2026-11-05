import type { PgBoss } from "pg-boss";
import { createBoss, type BossTuning } from "./boss.js";
import type { WorkerConfig } from "./config.js";
import { registerHandlers } from "./handlers.js";
import { errorFields, log } from "./log.js";

export async function startWorker(config: WorkerConfig, tuning?: BossTuning): Promise<PgBoss> {
  const boss = createBoss(config.databaseUrl, tuning);
  boss.on("error", (error: Error) => log("error", "pgboss.error", { error: errorFields(error) }));
  await boss.start();
  await registerHandlers(boss, config);
  return boss;
}
