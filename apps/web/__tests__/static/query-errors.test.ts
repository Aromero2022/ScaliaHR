import { describe, expect, it } from "vitest";
import { isServerActionFile, sourceFiles } from "./source-exports";
import { uncheckedQueries } from "./query-errors";

/**
 * D45: every Supabase query under src reads its error, in pages, layouts,
 * Server Actions, HTTP routes and the libraries they call. A failed query
 * resolves with `data: null`; code that reads only `data` showed the failure
 * as "Sin información laboral registrada". The analyzer is query-errors.ts.
 */

const all = sourceFiles();
const pages = all.filter(({ rel }) => /(^|\/)(page|layout)\.tsx$/.test(rel));
const actions = all.filter(({ source }) => isServerActionFile(source));
const routes = all.filter(({ rel }) => /(^|\/)route\.ts$/.test(rel));

const reasons = (source: string) => uncheckedQueries(source).map(({ line, reason }) => `${line}: ${reason}`);

describe("query errors (D45)", () => {
  it("finds the pages, Server Actions and routes it checks", () => {
    expect(pages.map(({ rel }) => rel)).toEqual(
      expect.arrayContaining(["app/(protected)/employees/[id]/page.tsx", "app/(protected)/layout.tsx", "app/(protected)/admin-center/page.tsx"]),
    );
    expect(actions.map(({ rel }) => rel)).toEqual(
      expect.arrayContaining(["app/(protected)/employees/[id]/actions.ts", "app/login/actions.ts", "lib/tenant/actions.ts"]),
    );
    expect(routes.map(({ rel }) => rel)).toEqual(expect.arrayContaining(["app/(protected)/lms/launch/route.ts", "app/api/colleagues/route.ts"]));
  });

  describe("negative controls: each of these is reported", () => {
    it("a page that reads only data", () => {
      const source = `export default async function Page() {
  const { data: job } = await supabase.from("ec_job_information").select("*").single();
  return job ? job.title : "Sin información laboral registrada";
}`;
      expect(reasons(source)).toEqual(["2: error is not destructured"]);
    });

    it("a Server Action that destructures the error and never reads it", () => {
      const source = `"use server";
export async function save() {
  const { data, error } = await supabase.from("users").select("id").maybeSingle();
  return { id: data?.id };
}`;
      expect(reasons(source)).toEqual(["3: error is never read"]);
    });

    it("an HTTP route that throws the result away, or returns it unchecked", () => {
      const source = `export async function GET() {
  await supabase.from("lms_user_map").insert({ id: 1 });
  return supabase.from("users").select("id");
}
export async function POST() {
  return await supabase.rpc("compute_arco_due_date");
}`;
      expect(reasons(source)).toEqual([
        "2: the result is thrown away",
        "3: the query is not awaited where its error can be read",
        "6: the result is returned unchecked",
      ]);
    });

    it("a result kept whole whose .error is never read", () => {
      const source = `async function f() {
  const res = await supabase.from("users").select("id");
  return res.data ?? [];
}`;
      expect(reasons(source)).toEqual(["2: res.error is never read"]);
    });

    it("a slot of Promise.all without its error, and results not bound one by one", () => {
      const source = `async function f(admin: boolean) {
  const [a, b] = await Promise.all([
    supabase.from("users").select("id"),
    admin ? supabase.from("roles").select("id") : Promise.resolve({ data: [], error: null }),
  ]);
  const all = await Promise.all([supabase.from("x").select("id")]);
  return [a.error, b.data, all];
}`;
      expect(reasons(source)).toEqual(["4: b.error is never read", "6: the results of Promise.all are not bound one by one"]);
    });

    it("a builder kept in a variable and never awaited where its error is read", () => {
      const source = `async function f(q: string) {
  let query = supabase.from("users").select("id");
  if (q) query = query.eq("name", q);
  return query;
}`;
      expect(reasons(source)).toEqual(["2: query is never awaited where its error can be read"]);
    });

    it("a query awaited inside another expression", () => {
      const source = `async function f() {
  return (await supabase.from("users").select("id")).data ?? [];
}`;
      expect(reasons(source)).toEqual(["2: the result is used inside an expression without checking its error"]);
    });
  });

  it("accepts the patterns the code uses, and Array.from is not a query", () => {
    const source = `async function f(q: string, admin: boolean) {
  const { data, error } = await supabase.from("users").select("id").maybeSingle();
  if (error) return null;
  const res = await supabase.rpc("get_direct_reports", {});
  if (res.error) return null;
  let query = supabase.from("users").select("id");
  if (q) query = query.eq("name", q);
  const { data: rows, error: rowsError } = await query;
  const [a, b] = await Promise.all([
    supabase.from("users").select("id"),
    admin ? supabase.from("roles").select("id") : Promise.resolve({ data: [], error: null }),
  ]);
  const { data: one, error: oneError } = await (q ? supabase.from("t").select("id").eq("slug", q) : supabase.from("t").select("id")).maybeSingle();
  return [data, rows, rowsError, a.error, b.error, one, oneError, Array.from([1, 2])];
}`;
    expect(reasons(source)).toEqual([]);
  });

  for (const { rel, source } of all) {
    const queries = uncheckedQueries(source, rel);
    it(`${rel} reads the error of every query`, () => {
      expect(queries.map(({ line, text, reason }) => `${line}: ${reason} — ${text}`)).toEqual([]);
    });
  }
});
