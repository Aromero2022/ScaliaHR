import { z } from "zod";

const PersonId = z.guid();

/**
 * Query string of the employee list: a bad value falls back to no search / page 1.
 * 9c PR 6c: `person` is the id ⌘K opens the list on (never an email in the URL).
 * Absent: no filter. A guid: that person, within the caller's tenant. Anything
 * else, a repeated parameter included: null, which matches no one, never the
 * whole list.
 */
export const EmployeeListParams = z.object({
  q: z.string().trim().max(100).catch(""),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  person: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : PersonId.safeParse(value.trim()).success ? value.trim() : null))
    .catch(null),
});
