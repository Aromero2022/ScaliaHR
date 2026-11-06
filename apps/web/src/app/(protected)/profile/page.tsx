import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("*, ec_job_information!ec_job_information_user_id_fkey(job_title, department_id, manager_id, start_date, end_date), departments(name)")
    .eq("auth_uid", authUser.id)
    .single();

  if (!profile) {
    return (
      <div className="text-fg-muted">
        No se encontró perfil de usuario.
      </div>
    );
  }

  const ecJobs = Array.isArray(profile.ec_job_information)
    ? profile.ec_job_information
    : profile.ec_job_information ? [profile.ec_job_information] : [];
  const currentJob = ecJobs.find(
    (j: { end_date: string | null }) => j.end_date === null,
  ) as { job_title: string; department_id: string | null; manager_id: string | null } | undefined;
  const dept = Array.isArray(profile.departments) ? profile.departments[0] : profile.departments;

  const managerId = currentJob?.manager_id ?? null;
  const { data: manager } = managerId
    ? await supabase
        .from("users")
        .select("first_name, last_name, email")
        .eq("id", managerId)
        .single()
    : { data: null };

  const { data: feedback } = await supabase
    .from("continuous_feedbacks")
    .select("*")
    .eq("subject_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-fg">Mi Perfil</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Información personal y profesional
        </p>
      </div>

      {/* Avatar + headline */}
      <div className="flex items-center gap-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-xl font-bold text-on-accent">
          {profile.first_name[0]}
          {profile.last_name[0]}
        </div>
        <div>
          <p className="text-lg font-semibold text-fg">
            {profile.first_name} {profile.last_name}
          </p>
          <p className="text-sm text-fg-muted">
            {currentJob?.job_title ?? "Sin puesto"} &middot;{" "}
            {dept?.name ?? "Sin departamento"}
          </p>
        </div>
      </div>

      {/* Details card */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">Datos Personales</h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Email" value={profile.email} />
          <Field label="Employee ID" value={profile.employee_id ?? "—"} />
          <Field label="Estado" value={profile.status} />
          <Field
            label="Fecha de ingreso"
            value={
              profile.hire_date
                ? new Date(profile.hire_date).toLocaleDateString("es-ES")
                : "—"
            }
          />
          <Field
            label="Manager"
            value={
              manager
                ? `${manager.first_name} ${manager.last_name}`
                : "Sin manager"
            }
          />
          <Field label="Departamento" value={dept?.name ?? "—"} />
        </dl>
      </section>

      {/* Job Info card */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          Información del Puesto
        </h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Título" value={currentJob?.job_title ?? "—"} />
          <Field label="Departamento" value={dept?.name ?? "—"} />
        </dl>
      </section>

      {/* 9-Box scores */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          Talent Review (9-Box)
        </h2>
        <div className="flex gap-12">
          <ScoreCircle label="Performance" value={profile.performance_score} />
          <ScoreCircle label="Potential" value={profile.potential_score} />
        </div>
      </section>

      {/* Feedback */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          Feedback Recibido
        </h2>
        {feedback && feedback.length > 0 ? (
          <ul className="space-y-3">
            {feedback.map((f) => (
              <li
                key={f.id}
                className="rounded-lg border border-line px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-fg-muted">
                    {f.category}
                  </span>
                  <span className="text-xs text-fg-subtle">
                    {new Date(f.created_at).toLocaleDateString("es-ES")}
                  </span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{f.content}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-subtle">No hay feedback registrado.</p>
        )}
      </section>
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

function ScoreCircle({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-accent-line text-xl font-bold text-accent-fg">
        {value ?? "—"}
      </div>
      <p className="mt-2 text-xs font-medium text-fg-muted">{label}</p>
    </div>
  );
}
