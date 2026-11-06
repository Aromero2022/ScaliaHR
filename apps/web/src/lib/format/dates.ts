import { messages } from "@/lib/i18n/es-MX";

// D42: dates are formatted on the server, in es-MX, by one of two explicit
// functions that the caller chooses. Neither guesses from the column name or
// from the shape of the value. Client components receive the formatted text,
// so it is the same in every browser time zone and hydration cannot differ.
//
// formatDateOnly() is for these columns, which hold a calendar date with no
// time, and for nothing else:
//   - performance_goals.period_start, performance_goals.period_end,
//     performance_goals.due_date and users.hire_date: timestamptz holding
//     midnight UTC (to become `date` in Phases 16 and 14);
//   - ec_personal_information.start_date, .end_date and .date_of_birth;
//     ec_job_information.start_date and .end_date; ec_compensation.start_date
//     and .end_date; arco_requests.due_date: date.
// The timestamptz columns hold midnight UTC only because the Postgres
// sessions run in UTC: '2026-01-01'::timestamptz is 2026-01-01T00:00:00+00:00.
// __tests__/integration/dates-utc-session.test.ts fails if that changes.
//
// formatInstant() is for every other timestamp (created_at, completed_at…):
// a moment, shown in the tenant's time zone with a 12-hour clock.

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?(?:Z|\+00(?::?00)?))?$/;

const dateOnlyFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A calendar date: "2026-12-31" (a `date`) or "2026-12-31T00:00:00+00:00"
 * (midnight UTC in a `timestamptz`) is "31 dic 2026" in every zone. Any other
 * value is an error, not a guess. Null or empty is "—".
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (value == null || value === "") return messages.common.empty;
  const match = CALENDAR_DATE.exec(value);
  if (!match) throw new RangeError(`formatDateOnly expects a calendar date (YYYY-MM-DD, or midnight UTC), got "${value}"`);
  const [, year, month, day] = match;
  return dateOnlyFormat.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

const instantFormats = new Map<string, Intl.DateTimeFormat>();

function instantFormat(timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${withTime}`;
  let format = instantFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "numeric", minute: "2-digit", hourCycle: "h12" } : {}),
      timeZone,
    });
    instantFormats.set(key, format);
  }
  return format;
}

/**
 * A moment in the given time zone: "5 nov 2026, 11:30 p.m.", or only the
 * day ("5 nov 2026") with `withTime: false`. Null or empty is "—".
 */
export function formatInstant(
  value: string | Date | null | undefined,
  timeZone: string,
  { withTime = true }: { withTime?: boolean } = {},
): string {
  if (value == null || value === "") return messages.common.empty;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`formatInstant expects a timestamp, got "${String(value)}"`);
  return instantFormat(timeZone, withTime).format(date);
}

/** Today's calendar date (YYYY-MM-DD) in the given time zone, e.g. for "overdue" and form defaults. */
export function calendarDateIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const ZONE_NAME = /^[A-Za-z]+(?:[/_-][A-Za-z0-9+_-]+)*$/;

/** The canonical name of an IANA time zone ("america/mexico_city" → "America/Mexico_City"), or null. Offsets are not zones. */
export function canonicalTimeZone(value: string): string | null {
  if (!ZONE_NAME.test(value)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
