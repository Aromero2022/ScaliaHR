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
    const message = await safeError("employees.list", queryError, "No se pudo cargar la lista de empleados.");
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">Empleados</h1>
        </div>
        <div className="rounded-xl border border-danger-line bg-danger-subtle p-6 text-center">
          <p className="text-sm text-danger-fg">
            {message}
          </p>
        </div>
      </div>
    );
  }

  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const isAdmin = (await can(bizUser.id, "ec.manage_employees", "view")).allowed;

  let viewableIds: Set<string> | null = null;
  if (!isAdmin) {
    const ids = new Set<string>();
    ids.add(bizUser.id);

    const { data: reports } = await supabase
      .from("ec_job_information")
      .select("user_id")
      .eq("manager_id", bizUser.id)
      .is("end_date", null);

    if (reports) {
      for (const r of reports) ids.add(r.user_id as string);
    }

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
          <h1 className="text-2xl font-bold text-fg">Empleados</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Directorio de empleados activos — Employee Central
          </p>
        </div>
        <Suspense>
          <SearchInput placeholder="Buscar por nombre, email o ID…" />
        </Suspense>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-medium uppercase tracking-wider text-fg-subtle">
                <th className="px-6 py-3">Empleado</th>
                <th className="px-6 py-3">Puesto</th>
                <th className="px-6 py-3">Departamento</th>
                <th className="px-6 py-3">ID Empleado</th>
                <th className="px-6 py-3">Estado</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-fg-subtle"
                  >
                    {search
                      ? `No se encontraron empleados para "${search}".`
                      : "No hay empleados registrados."}
                  </td>
                </tr>
              ) : (
                rows.map((emp) => (
                  <tr
                    key={emp.id}
                    className="transition hover:bg-surface-hover"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent-fg">
                          {initials(emp.firstName, emp.lastName)}
                        </div>
                        <div>
                          <p className="font-medium text-fg">
                            {emp.firstName} {emp.lastName}
                          </p>
                          <p className="text-xs text-fg-subtle">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-fg-muted">
                      {emp.jobTitle ?? emp.positionTitle ?? "—"}
                    </td>
                    <td className="px-6 py-4 text-fg-muted">
                      {emp.department ?? "—"}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-fg-muted">
                      {emp.employeeId ?? "—"}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={emp.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      {emp.canView ? (
                        <Link
                          href={`/employees/${emp.id}`}
                          className="text-sm font-medium text-accent-fg transition hover:text-fg"
                        >
                          Ver perfil →
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between border-t border-line px-6 py-3">
            <p className="text-xs text-fg-subtle">
              Mostrando {showingFrom}–{showingTo} de {total}
            </p>
            <div className="flex gap-2">
              {page > 1 ? (
                <PaginationLink
                  page={page - 1}
                  search={search}
                  label="← Anterior"
                />
              ) : (
                <span className="rounded-lg px-3 py-1.5 text-xs text-fg-subtle">
                  ← Anterior
                </span>
              )}
              <span className="rounded-lg px-3 py-1.5 text-xs text-fg-muted">
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <PaginationLink
                  page={page + 1}
                  search={search}
                  label="Siguiente →"
                />
              ) : (
                <span className="rounded-lg px-3 py-1.5 text-xs text-fg-subtle">
                  Siguiente →
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
      className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-muted transition hover:border-accent hover:text-fg"
    >
      {label}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-success-subtle text-success-fg",
    INACTIVE: "bg-surface-raised text-fg-muted",
    ON_LEAVE: "bg-warning-subtle text-warning-fg",
    TERMINATED: "bg-danger-subtle text-danger-fg",
  };

  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.INACTIVE}`}
    >
      {status === "ACTIVE" ? "Activo" : status === "ON_LEAVE" ? "Permiso" : status === "TERMINATED" ? "Baja" : "Inactivo"}
    </span>
  );
}
