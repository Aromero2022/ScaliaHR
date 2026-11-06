import { afterEach, describe, expect, it } from "vitest";
import { calendarDateIn, canonicalTimeZone, formatDateOnly, formatInstant } from "@/lib/format/dates";

/** D42: the two explicit date functions, the tenant's "today" and the zone check. */

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe("formatDateOnly (calendar dates, no zone conversion)", () => {
  it("formats a `date` and a midnight-UTC `timestamptz` as the same day", () => {
    expect(formatDateOnly("2026-12-31")).toBe("31 dic 2026");
    expect(formatDateOnly("2026-12-31T00:00:00+00:00")).toBe("31 dic 2026");
    expect(formatDateOnly("2026-01-01T00:00:00Z")).toBe("1 ene 2026");
    expect(formatDateOnly("2026-01-01T00:00:00.000Z")).toBe("1 ene 2026");
  });

  it.each(["UTC", "America/Mexico_City", "America/Tijuana", "Pacific/Kiritimati", "Etc/GMT+12", "Asia/Tokyo"])(
    "gives the same day whatever the process zone (%s)",
    (tz) => {
      process.env.TZ = tz;
      expect(formatDateOnly("2026-01-01T00:00:00+00:00")).toBe("1 ene 2026");
      expect(formatDateOnly("2026-12-31")).toBe("31 dic 2026");
    },
  );

  it('shows "—" for no value', () => {
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnly(undefined)).toBe("—");
    expect(formatDateOnly("")).toBe("—");
  });

  it.each(["2026-01-01T06:00:00+00:00", "2026-01-01T00:00:00-06:00", "2026-01-01 00:00:00+00", "01/01/2026", "2026-1-1", "hoy"])(
    "refuses %j instead of guessing",
    (value) => expect(() => formatDateOnly(value)).toThrow(RangeError),
  );
});

describe("formatInstant (moments in the tenant's zone)", () => {
  it("uses the given zone and a 12-hour clock", () => {
    // 05:30 UTC on 6 Nov is 11:30 p.m. on 5 Nov in Mexico City and 2:30 p.m. on 6 Nov in Tokyo.
    expect(formatInstant("2026-11-06T05:30:00Z", "America/Mexico_City")).toBe("5 nov 2026, 11:30 p.m.");
    expect(formatInstant("2026-11-06T05:30:00Z", "Asia/Tokyo")).toBe("6 nov 2026, 2:30 p.m.");
    expect(formatInstant("2026-11-06T05:30:00+00:00", "UTC")).toBe("6 nov 2026, 5:30 a.m.");
  });

  it("can show only the day, still in the tenant's zone", () => {
    expect(formatInstant("2026-11-06T05:30:00Z", "America/Mexico_City", { withTime: false })).toBe("5 nov 2026");
    expect(formatInstant(new Date("2026-11-06T05:30:00Z"), "Asia/Tokyo", { withTime: false })).toBe("6 nov 2026");
  });

  it("does not depend on the process zone", () => {
    process.env.TZ = "Pacific/Kiritimati";
    expect(formatInstant("2026-11-06T05:30:00Z", "America/Mexico_City")).toBe("5 nov 2026, 11:30 p.m.");
  });

  it("follows daylight saving time of the zone", () => {
    // New York moves from UTC-5 to UTC-4 on 8 Mar 2026.
    expect(formatInstant("2026-03-08T06:30:00Z", "America/New_York")).toBe("8 mar 2026, 1:30 a.m.");
    expect(formatInstant("2026-03-08T07:30:00Z", "America/New_York")).toBe("8 mar 2026, 3:30 a.m.");
  });

  it('shows "—" for no value and refuses an invalid timestamp or zone', () => {
    expect(formatInstant(null, "UTC")).toBe("—");
    expect(() => formatInstant("not a date", "UTC")).toThrow(RangeError);
    expect(() => formatInstant("2026-11-06T05:30:00Z", "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("calendarDateIn (today in the tenant's zone)", () => {
  it("is the local date of the zone, not the UTC date", () => {
    const evening = new Date("2026-11-06T05:30:00Z");
    expect(calendarDateIn("America/Mexico_City", evening)).toBe("2026-11-05");
    expect(calendarDateIn("UTC", evening)).toBe("2026-11-06");
    expect(calendarDateIn("Asia/Tokyo", evening)).toBe("2026-11-06");
  });
});

describe("canonicalTimeZone", () => {
  it("accepts IANA zones and returns their canonical name", () => {
    expect(canonicalTimeZone("America/Mexico_City")).toBe("America/Mexico_City");
    expect(canonicalTimeZone("america/mexico_city")).toBe("America/Mexico_City");
    expect(canonicalTimeZone("UTC")).toBe("UTC");
    // ICU may give its own canonical alias (America/Buenos_Aires); either is a valid zone.
    expect(canonicalTimeZone("America/Argentina/Buenos_Aires")).toMatch(/^America\/(Argentina\/)?Buenos_Aires$/);
  });

  it.each(["", "Mars/Olympus", "+01:00", "-06:00", "America/Mexico_City; DROP", " UTC"])("refuses %j", (value) =>
    expect(canonicalTimeZone(value)).toBeNull(),
  );
});
