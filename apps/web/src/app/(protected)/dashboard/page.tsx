import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("*, ec_job_information!ec_job_information_user_id_fkey(job_title, end_date), departments(name)")
    .eq("auth_uid", authUser.id)
    .single();

  if (!profile) {
    return (
      <div className="text-slate-400">
        No se encontró perfil de usuario. Contacte al administrador.
      </div>
    );
  }

  const ecJobs = Array.isArray(profile.ec_job_information)
    ? profile.ec_job_information
    : profile.ec_job_information ? [profile.ec_job_information] : [];
  const currentJob = ecJobs.find(
    (j: { end_date: string | null }) => j.end_date === null,
  ) as { job_title: string } | undefined;
  const dept = Array.isArray(profile.departments) ? profile.departments[0] : profile.departments;

  const { count: totalEmployees } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("status", "ACTIVE");

  const { count: totalDepts } = await supabase
    .from("departments")
    .select("*", { count: "exact", head: true });

  const { data: recentGoals } = await supabase
    .from("performance_goals")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          Bienvenido, {profile.first_name}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {currentJob?.job_title ?? "Sin puesto asignado"} &middot;{" "}
          {dept?.name ?? "Sin departamento"}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Empleados Activos"
          value={totalEmployees ?? 0}
          accent="indigo"
        />
        <KpiCard
          label="Departamentos"
          value={totalDepts ?? 0}
          accent="emerald"
        />
        <KpiCard
          label="Performance Score"
          value={profile.performance_score ?? "—"}
          accent="amber"
        />
        <KpiCard
          label="Potential Score"
          value={profile.potential_score ?? "—"}
          accent="violet"
        />
      </div>

      {/* Profile Summary */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Mi Información
        </h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nombre completo" value={`${profile.first_name} ${profile.last_name}`} />
          <Field label="Email" value={profile.email} />
          <Field label="Employee ID" value={profile.employee_id ?? "—"} />
          <Field label="Estado" value={profile.status} />
          <Field label="Fecha de ingreso" value={profile.hire_date ? new Date(profile.hire_date).toLocaleDateString("es-ES") : "—"} />
          <Field label="Puesto" value={currentJob?.job_title ?? "—"} />
          <Field label="Departamento" value={dept?.name ?? "—"} />
        </dl>
      </section>

      {/* Goals */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Mis Objetivos (PMGM)
        </h2>
        {recentGoals && recentGoals.length > 0 ? (
          <div className="space-y-3">
            {recentGoals.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-slate-200">{g.title}</p>
                  <p className="text-xs text-slate-500">
                    {g.period_start} → {g.period_end}
                  </p>
                </div>
                <GoalBadge status={g.status} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No hay objetivos registrados aún.
          </p>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  const ring: Record<string, string> = {
    indigo: "border-indigo-500/30",
    emerald: "border-emerald-500/30",
    amber: "border-amber-500/30",
    violet: "border-violet-500/30",
  };
  const text: Record<string, string> = {
    indigo: "text-indigo-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
  };

  return (
    <div
      className={`rounded-xl border bg-slate-900 p-5 ${ring[accent] ?? "border-slate-800"}`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={`mt-2 text-3xl font-bold ${text[accent] ?? "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-200">{value}</dd>
    </div>
  );
}

function GoalBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    NOT_STARTED: { bg: "bg-slate-800", text: "text-slate-400" },
    ON_TRACK: { bg: "bg-emerald-900/50", text: "text-emerald-400" },
    AT_RISK: { bg: "bg-amber-900/50", text: "text-amber-400" },
    COMPLETED: { bg: "bg-indigo-900/50", text: "text-indigo-400" },
    CANCELLED: { bg: "bg-red-900/50", text: "text-red-400" },
  };
  const style = map[status] ?? map.NOT_STARTED;
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
