import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import { isModuleRouteBlocked } from "@/lib/tenant/module-guards";
import { redirect } from "next/navigation";
import Link from "next/link";
import SearchInput from "@/components/search-input";
import AccessDenied from "@/components/access-denied";
import { can } from "@/lib/authz/can";
import { Suspense } from "react";
import { safeError } from "@/lib/errors/safe-error";
import { ilikeAnyOf } from "@/lib/postgrest/filters";
import { EmployeeListParams } from "@/lib/validations/employees";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageLoadError } from "@/components/ui/load-error";
import { messages } from "@/lib/i18n/es-MX";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const t = messages.employees;

const PAGE_SIZE = 20;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q: search, page } = EmployeeListParams.parse(await searchParams);
  const claims = await requireAuth();
  if (!claims.tenantId) redirect("/dashboard");

  const flags = await getModuleFlags(claims.tenantId);
  if (isModuleRouteBlocked("/employees", flags)) redirect("/dashboard");

  const supabase = await createClient();
  const bizUser = await getCurrentUser();

  if (!bizUser) redirect("/login");

  const { allowed } = await can(bizUser.id, "ec.view_org_chart", "view");
  if (!allowed) return <AccessDenied />;

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("users")
    .select(
      "id, first_name, last_name, email, employee_id, status, departments(name), positions(title), ec_job_information!ec_job_information_user_id_fkey(job_title, end_date)",
      { count: "exact" }
    )
    .eq("status", "ACTIVE")
    .is("deleted_at", null)
    .order("last_name", { ascending: true })
    .range(from, to);

  if (search) {
    query = query.or(ilikeAnyOf(["first_name", "last_name", "email", "employee_id"], search));
  }

  const { data: employees, count, error: queryError } = await query;

  if (queryError) {
    return <PageLoadError title={t.heading} message={await safeError("employees.list", queryError, t.loadError)} />;
  }

  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const isAdmin = (await can(bizUser.id, "ec.manage_employees", "view")).allowed;

  let viewableIds: Set<string> | null = null;
  if (!isAdmin) {
    const ids = new Set<string>();
    ids.add(bizUser.id);

    const { data: reports, error: reportsError } = await supabase
      .from("ec_job_information")
      .select("user_id")
      .eq("manager_id", bizUser.id)
      .is("end_date", null);

    // D45: without the direct reports the list cannot tell which rows open a
    // profile; it shows the list's error instead of rows that do not open.
    if (reportsError) {
      return <PageLoadError title={t.heading} message={await safeError("employees.reports", reportsError, t.loadError)} />;
    }
    for (const r of reports) ids.add(r.user_id as string);

    viewableIds = ids;
  }

  const rows = (employees ?? []).map((emp) => {
    const dept = Array.isArray(emp.departments)
      ? emp.departments[0]
      : emp.departments;
    const pos = Array.isArray(emp.positions)
      ? emp.positions[0]
      : emp.positions;

    const currentJob = Array.isArray(emp.ec_job_information)
      ? emp.ec_job_information.find(
          (j: { end_date: string | null }) => j.end_date === null
        )
      : emp.ec_job_information;

    const canView = viewableIds === null || viewableIds.has(emp.id as string);

    return {
      id: emp.id as string,
      firstName: emp.first_name as string,
      lastName: emp.last_name as string,
      email: emp.email as string,
      employeeId: emp.employee_id as string | null,
      status: emp.status as string,
      department: (dept as { name: string } | null)?.name ?? null,
      positionTitle: (pos as { title: string } | null)?.title ?? null,
      jobTitle: (currentJob as { job_title: string } | null)?.job_title ?? null,
      canView,
    };
  });

  function initials(first: string, last: string): string {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  }

  const showingFrom = total === 0 ? 0 : from + 1;
  const showingTo = Math.min(from + PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">{t.heading}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {t.subheading}
          </p>
        </div>
        <Suspense>
          <SearchInput placeholder={t.searchPlaceholder} />
        </Suspense>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <Table
          caption={t.heading}
          rows={rows}
          rowKey={(emp) => emp.id}
          empty={search ? t.noResultsFor(search) : t.none}
          columns={[
            {
              key: "employee",
              header: t.columns.employee,
              className: "px-6 py-4",
              cell: (emp) => (
                <div className="flex items-center gap-3">
                  <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent-fg">
                    {initials(emp.firstName, emp.lastName)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-fg">
                      {emp.firstName} {emp.lastName}
                    </p>
                    <p className="break-words text-xs text-fg-subtle">{emp.email}</p>
                  </div>
                </div>
              ),
            },
            { key: "job", header: t.columns.jobTitle, cell: (emp) => emp.jobTitle ?? emp.positionTitle ?? messages.common.empty },
            { key: "department", header: t.columns.department, cell: (emp) => emp.department ?? messages.common.empty },
            {
              key: "number",
              header: t.columns.employeeNumber,
              className: "px-6 py-4 font-mono text-xs text-fg-muted",
              cell: (emp) => emp.employeeId ?? messages.common.empty,
            },
            { key: "status", header: t.columns.status, className: "px-6 py-4", cell: (emp) => <Badge enumName="EmployeeStatus" value={emp.status} /> },
            {
              key: "profile",
              header: t.columns.actions,
              action: true,
              className: "px-6 py-4 text-right",
              cell: (emp) =>
                emp.canView ? (
                  <Link href={`/employees/${emp.id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent-fg transition hover:text-fg">
                    {t.viewProfile}
                    <span className="sr-only">{t.ofEmployee(`${emp.firstName} ${emp.lastName}`)}</span>
                    <span aria-hidden="true">&nbsp;→</span>
                  </Link>
                ) : null,
            },
          ]}
        />

        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 md:px-6">
            <p className="text-xs text-fg-subtle">
              {t.showing(showingFrom, showingTo, total)}
            </p>
            <div className="flex gap-2">
              {page > 1 ? (
                <PaginationLink
                  page={page - 1}
                  search={search}
                  label={t.previous}
                />
              ) : (
                <span className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs text-fg-subtle">
                  {t.previous}
                </span>
              )}
              <span className="rounded-lg px-3 py-1.5 text-xs text-fg-muted">
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <PaginationLink
                  page={page + 1}
                  search={search}
                  label={t.next}
                />
              ) : (
                <span className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs text-fg-subtle">
                  {t.next}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PaginationLink({
  page,
  search,
  label,
}: {
  page: number;
  search: string;
  label: string;
}) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const href = `/employees${params.toString() ? `?${params.toString()}` : ""}`;

  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-xs text-fg-muted transition hover:border-accent hover:text-fg"
    >
      {label}
    </Link>
  );
}
