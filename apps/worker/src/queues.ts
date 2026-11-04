// Queue names only. Queues and their retry/dead-letter options are declared in
// supabase/migrations (D17); the worker never creates or alters them.
export const QUEUES = {
  ping: "system.ping",
  deadLetter: "system.dead_letter",
} as const;
