import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

/**
 * Unit tests for ARCO anonymization and data export logic.
 * Tests the pure functions that mirror what the DB functions do.
 */

type UserRecord = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  is_anonymized: boolean;
  deleted_at: string | null;
};

type PersonalInfo = {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  personal_email: string | null;
  national_id: string | null;
  tax_id: string | null;
  address_line1: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};

function anonymizeUser(user: UserRecord, personalRecords: PersonalInfo[]) {
  const token = "ANON-" + createHash("md5")
    .update(user.id + Date.now().toString())
    .digest("hex")
    .slice(0, 8);

  const anonymizedUser: UserRecord = {
    ...user,
    first_name: token,
    last_name: "ANONIMIZADO",
    email: `${token}@removed.local`,
    is_anonymized: true,
    deleted_at: new Date().toISOString(),
    status: "TERMINATED",
  };

  const anonymizedPersonal: PersonalInfo[] = personalRecords.map((p) => ({
    ...p,
    first_name: token,
    last_name: "ANONIMIZADO",
    phone: null,
    personal_email: null,
    national_id: null,
    tax_id: null,
    address_line1: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
  }));

  return { anonymizedUser, anonymizedPersonal };
}

function exportUserData(user: UserRecord, jobs: unknown[], comp: unknown[], personal: unknown[]) {
  const payload = {
    user,
    job_information: jobs,
    compensation: comp,
    personal_information: personal,
    exported_at: new Date().toISOString(),
  };
  const jsonStr = JSON.stringify(payload, null, 2);
  const hash = createHash("sha256").update(jsonStr).digest("hex");
  return { json: jsonStr, hash };
}

function computeArcoDueDate(startDate: Date): Date {
  let count = 0;
  const date = new Date(startDate);
  while (count < 20) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return date;
}

describe("ARCO: anonymize_user", () => {
  const user: UserRecord = {
    id: "e0000000-0000-0000-0000-000000000005",
    first_name: "Pedro",
    last_name: "Sánchez",
    email: "pedro@acme.dev",
    status: "ACTIVE",
    is_anonymized: false,
    deleted_at: null,
  };

  const personal: PersonalInfo[] = [
    {
      id: "p1",
      user_id: user.id,
      first_name: "Pedro",
      last_name: "Sánchez",
      phone: "+52 55 1234 5678",
      personal_email: "pedro.personal@gmail.com",
      national_id: "SAPC850101HDFRRL09",
      tax_id: "SAPC850101AB3",
      address_line1: "Calle Reforma 100",
      emergency_contact_name: "María Sánchez",
      emergency_contact_phone: "+52 55 8765 4321",
    },
  ];

  it("replaces user PII with token", () => {
    const { anonymizedUser } = anonymizeUser(user, personal);
    expect(anonymizedUser.first_name).toMatch(/^ANON-/);
    expect(anonymizedUser.last_name).toBe("ANONIMIZADO");
    expect(anonymizedUser.email).toMatch(/@removed\.local$/);
    expect(anonymizedUser.is_anonymized).toBe(true);
    expect(anonymizedUser.status).toBe("TERMINATED");
    expect(anonymizedUser.deleted_at).not.toBeNull();
  });

  it("nullifies personal information PII fields", () => {
    const { anonymizedPersonal } = anonymizeUser(user, personal);
    const p = anonymizedPersonal[0];
    expect(p.phone).toBeNull();
    expect(p.personal_email).toBeNull();
    expect(p.national_id).toBeNull();
    expect(p.tax_id).toBeNull();
    expect(p.address_line1).toBeNull();
    expect(p.emergency_contact_name).toBeNull();
    expect(p.emergency_contact_phone).toBeNull();
  });

  it("preserves non-PII fields (id, user_id)", () => {
    const { anonymizedPersonal } = anonymizeUser(user, personal);
    expect(anonymizedPersonal[0].id).toBe("p1");
    expect(anonymizedPersonal[0].user_id).toBe(user.id);
  });

  it("keeps no original personal value anywhere in its result", () => {
    const result = JSON.stringify(anonymizeUser(user, personal));
    for (const original of ["Pedro", "Sánchez", "pedro@acme.dev", "pedro.personal@gmail.com", "SAPC850101HDFRRL09"]) {
      expect(result).not.toContain(original);
    }
  });

  it("uses consistent token across user and personal records", () => {
    const { anonymizedUser, anonymizedPersonal } = anonymizeUser(user, personal);
    expect(anonymizedPersonal[0].first_name).toBe(anonymizedUser.first_name);
  });
});

describe("ARCO: export_user_data", () => {
  it("produces valid JSON with all sections", () => {
    const result = exportUserData(
      { id: "u1", first_name: "Test", last_name: "User", email: "test@test.com", status: "ACTIVE", is_anonymized: false, deleted_at: null },
      [{ job_title: "Dev" }],
      [{ base_salary: 50000 }],
      [{ first_name: "Test" }]
    );

    const parsed = JSON.parse(result.json);
    expect(parsed.user.first_name).toBe("Test");
    expect(parsed.job_information).toHaveLength(1);
    expect(parsed.compensation).toHaveLength(1);
    expect(parsed.personal_information).toHaveLength(1);
    expect(parsed.exported_at).toBeDefined();
  });

  it("generates deterministic SHA-256 hash for same input", () => {
    const input = { id: "u1", first_name: "A", last_name: "B", email: "a@b.c", status: "ACTIVE", is_anonymized: false, deleted_at: null };
    const r1 = exportUserData(input, [], [], []);
    const r2 = exportUserData(input, [], [], []);
    expect(r1.hash).toBe(r2.hash);
    expect(r1.hash).toHaveLength(64);
  });

  it("different data produces different hash", () => {
    const u1 = { id: "u1", first_name: "A", last_name: "B", email: "a@b.c", status: "ACTIVE", is_anonymized: false, deleted_at: null };
    const u2 = { ...u1, first_name: "C" };
    const r1 = exportUserData(u1, [], [], []);
    const r2 = exportUserData(u2, [], [], []);
    expect(r1.hash).not.toBe(r2.hash);
  });
});

describe("ARCO: compute_arco_due_date", () => {
  it("adds exactly 20 business days", () => {
    const start = new Date("2024-10-21");
    const due = computeArcoDueDate(start);
    expect(due.toISOString().slice(0, 10)).toBe("2024-11-18");
  });

  it("skips weekends", () => {
    const friday = new Date("2024-10-25");
    const due = computeArcoDueDate(friday);
    const dueDay = due.getDay();
    expect(dueDay).not.toBe(0);
    expect(dueDay).not.toBe(6);
  });

  it("handles start on a Friday", () => {
    const start = new Date("2024-11-01");
    const due = computeArcoDueDate(start);
    expect(due.getDay()).not.toBe(0);
    expect(due.getDay()).not.toBe(6);
  });

  it("handles year boundary", () => {
    const start = new Date("2024-12-20");
    const due = computeArcoDueDate(start);
    expect(due.getFullYear()).toBe(2025);
    expect(due.getDay()).not.toBe(0);
    expect(due.getDay()).not.toBe(6);
  });
});
