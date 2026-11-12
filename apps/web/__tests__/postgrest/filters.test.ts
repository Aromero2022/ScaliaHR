import { describe, expect, it } from "vitest";
import { containsPattern, eqAnyOf, ilikeAnyOf, quoted } from "@/lib/postgrest/filters";
import { EmployeeListParams } from "@/lib/validations/employees";

describe("PostgREST filter builders", () => {
  it('keep "a,id.eq.1)(" as one quoted value per column', () => {
    expect(ilikeAnyOf(["first_name", "email"], "a,id.eq.1)(")).toBe(
      'first_name.ilike."%a,id.eq.1)(%",email.ilike."%a,id.eq.1)(%"',
    );
  });

  it("escape quotes and backslashes so the value cannot leave its quotes", () => {
    expect(quoted('a",id.eq.1')).toBe('"a\\",id.eq.1"');
    expect(quoted("a\\")).toBe('"a\\\\"');
  });

  it("match % and _ as plain text and drop *", () => {
    expect(containsPattern("50%_x*")).toBe("%50\\%\\_x%");
    expect(containsPattern("a\\b")).toBe("%a\\\\b%");
  });

  it("build eq alternatives the same way", () => {
    expect(eqAnyOf(["author_id", "subject_id"], "u1")).toBe('author_id.eq."u1",subject_id.eq."u1"');
  });
});

describe("EmployeeListParams", () => {
  it("trims the search and reads the page", () => {
    expect(EmployeeListParams.parse({ q: "  ana ", page: "3" })).toEqual({ q: "ana", page: 3 });
  });

  it("falls back to no search and page 1 on bad input", () => {
    expect(EmployeeListParams.parse({ q: ["a", "b"], page: "-2" })).toEqual({ q: "", page: 1 });
    expect(EmployeeListParams.parse({ q: "x".repeat(101), page: "abc" })).toEqual({ q: "", page: 1 });
    expect(EmployeeListParams.parse({})).toEqual({ q: "", page: 1 });
  });

  it("reads ⌘K's person as a guid, and anything else as a filter that matches no one (9c PR 6c)", () => {
    const id = "e0000000-0000-0000-0000-000000000013";
    expect(EmployeeListParams.parse({}).person).toBeUndefined();
    expect(EmployeeListParams.parse({ person: id }).person).toBe(id);
    expect(EmployeeListParams.parse({ person: ` ${id} ` }).person).toBe(id);
    for (const bad of ["patricia.castro@acme.dev", "not-a-guid", "", "e0000000-0000-0000-0000-00000000001", [id, id]]) {
      expect(EmployeeListParams.parse({ person: bad }).person, JSON.stringify(bad)).toBeNull();
    }
  });
});
