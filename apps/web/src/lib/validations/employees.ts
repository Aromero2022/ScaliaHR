import { z } from "zod";

/** Query string of the employee list: a bad value falls back to no search / page 1. */
export const EmployeeListParams = z.object({
  q: z.string().trim().max(100).catch(""),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
