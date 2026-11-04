import { PgBoss } from "pg-boss";

// The pgboss schema comes from supabase/migrations (D1, D17). These options keep
// pg-boss from installing, migrating or reindexing anything at runtime. Cron
// scheduling stays off: its timekeeper declares an internal queue on every start.
export const BOSS_OPTIONS = {
  schema: "pgboss",
  migrate: false,
  createSchema: false,
  schedule: false,
  reindex: false,
  persistQueueStats: false,
} as const;

export interface BossTuning {
  supervise?: boolean;
  superviseIntervalSeconds?: number;
  maintenanceIntervalSeconds?: number;
  monitorIntervalSeconds?: number;
}

export function createBoss(connectionString: string, tuning: BossTuning = {}): PgBoss {
  return new PgBoss({ connectionString, ...tuning, ...BOSS_OPTIONS });
}
