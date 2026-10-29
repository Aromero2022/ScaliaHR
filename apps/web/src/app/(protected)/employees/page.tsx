import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SearchInput from "@/components/search-input";
import { Suspense } from "react";

const PAGE_SIZE = 20;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const search = params.q?.trim() ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
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
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,employee_id.ilike.%${search}%`
    );
  }

  const { data: employees, count, error: queryError } = await query;

  if (queryError) {
    console.error("[/employees] PostgREST query error:", queryError.message, queryError.details);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Empleados</h1>
        </div>
        <div className="rounded-xl border border-red-800 bg-red-950/50 p-6 text-center">
          <p className="text-sm text-red-300">
            Error al cargar empleados: {queryError.message}
          </p>
        </div>
      </div>
    );
  }

  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

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
          <h1 className="text-2xl font-bold text-white">Empleados</h1>
          <p className="mt-1 text-sm text-slate-400">
            Directorio de empleados activos — Employee Central
          </p>
        </div>
        <Suspense>
          <SearchInput placeholder="Buscar por nombre, email o ID…" />
        </Suspense>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">Empleado</th>
                <th className="px-6 py-3">Puesto</th>
                <th className="px-6 py-3">Departamento</th>
                <th className="px-6 py-3">ID Empleado</th>
                <th className="px-6 py-3">Estado</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-slate-500"
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
                    className="transition hover:bg-slate-800/40"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-xs font-semibold text-indigo-400">
                          {initials(emp.firstName, emp.lastName)}
                        </div>
                        <div>
                          <p className="font-medium text-slate-200">
                            {emp.firstName} {emp.lastName}
                          </p>
                          <p className="text-xs text-slate-500">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {emp.jobTitle ?? emp.positionTitle ?? "—"}
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {emp.department ?? "—"}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">
                      {emp.employeeId ?? "—"}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={emp.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/employees/${emp.id}`}
                        className="text-sm font-medium text-indigo-400 transition hover:text-indigo-300"
                      >
                        Ver perfil →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-6 py-3">
            <p className="text-xs text-slate-500">
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
                <span className="rounded-lg px-3 py-1.5 text-xs text-slate-600">
                  ← Anterior
                </span>
              )}
              <span className="rounded-lg px-3 py-1.5 text-xs text-slate-400">
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <PaginationLink
                  page={page + 1}
                  search={search}
                  label="Siguiente →"
                />
              ) : (
                <span className="rounded-lg px-3 py-1.5 text-xs text-slate-600">
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
      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-indigo-500 hover:text-indigo-400"
    >
      {label}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-900/50 text-emerald-400",
    INACTIVE: "bg-slate-800 text-slate-400",
    ON_LEAVE: "bg-amber-900/50 text-amber-400",
    TERMINATED: "bg-red-900/50 text-red-400",
  };

  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.INACTIVE}`}
    >
      {status === "ACTIVE" ? "Activo" : status === "ON_LEAVE" ? "Permiso" : status === "TERMINATED" ? "Baja" : "Inactivo"}
    </span>
  );
}
