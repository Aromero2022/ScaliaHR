import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { can } from "@/lib/authz/can";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function DashboardPage() {
  const claims = await requireAuth();
  const supabase = await createClient();

  const bizUser = await getCurrentUser();

  const { data: profile } = await supabase
    .from("users")
    .select("*, ec_job_information!ec_job_information_user_id_fkey(job_title, end_date), departments(name)")
    .eq("auth_uid", claims.userId)
    .single();

  if (!profile) {
    return (
      <div className="text-fg-muted">
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

  const canViewTenantKpis = bizUser
    ? (await can(bizUser.id, "ec.manage_employees", "view")).allowed
    : false;

  let totalEmployees: number | null = null;
  let totalDepts: number | null = null;
  if (canViewTenantKpis) {
    const [empRes, deptRes] = await Promise.all([
      supabase.from("users").select("*", { count: "exact", head: true }).eq("status", "ACTIVE"),
      supabase.from("departments").select("*", { count: "exact", head: true }),
    ]);
    totalEmployees = empRes.count;
    totalDepts = deptRes.count;
  }

  const { data: recentGoals } = await supabase
    .from("performance_goals")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-fg">
          Bienvenido, {profile.first_name}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {currentJob?.job_title ?? "Sin puesto asignado"} &middot;{" "}
          {dept?.name ?? "Sin departamento"}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {canViewTenantKpis && (
          <>
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
          </>
        )}
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
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
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
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          Mis Objetivos (PMGM)
        </h2>
        {recentGoals && recentGoals.length > 0 ? (
          <div className="space-y-3">
            {recentGoals.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-line px-4 py-3"
              >
                <div>
                  <p className="font-medium text-fg">{g.title}</p>
                  <p className="text-xs text-fg-subtle">
                    {g.period_start} → {g.period_end}
                  </p>
                </div>
                <GoalBadge status={g.status} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-subtle">
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
    indigo: "border-accent-line",
    emerald: "border-success-line",
    amber: "border-warning-line",
    violet: "border-category-2-line",
  };
  const text: Record<string, string> = {
    indigo: "text-accent-fg",
    emerald: "text-success-fg",
    amber: "text-warning-fg",
    violet: "text-category-2-fg",
  };

  return (
    <div
      className={`rounded-xl border bg-surface p-5 ${ring[accent] ?? "border-line"}`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <p className={`mt-2 text-3xl font-bold ${text[accent] ?? "text-fg"}`}>
        {value}
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-fg">{value}</dd>
    </div>
  );
}

function GoalBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    NOT_STARTED: { bg: "bg-surface-raised", text: "text-fg-muted" },
    ON_TRACK: { bg: "bg-success-subtle", text: "text-success-fg" },
    AT_RISK: { bg: "bg-warning-subtle", text: "text-warning-fg" },
    COMPLETED: { bg: "bg-accent-subtle", text: "text-accent-fg" },
    CANCELLED: { bg: "bg-danger-subtle", text: "text-danger-fg" },
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
