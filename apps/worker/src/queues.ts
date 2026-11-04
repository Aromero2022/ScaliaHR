import { EMAIL_QUEUE } from "@scaliahr/email/contract";

// Queue names only. Queues and their retry/dead-letter options are declared in
// supabase/migrations (D17, D20); the worker never creates or alters them.
export const QUEUES = {
  ping: "system.ping",
  deadLetter: "system.dead_letter",
  email: EMAIL_QUEUE,
} as const;
