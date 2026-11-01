import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import { isModuleRouteBlocked } from "@/lib/tenant/module-guards";
import { redirect, notFound } from "next/navigation";
import { can } from "@/lib/authz/can";
import AccessDenied from "@/components/access-denied";
import EmployeeHistory from "@/components/employee-history";
import ActionMenu from "./action-menu";

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtMoney(n: number | null | undefined, currency = "MXN"): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  }).format(n);
}

const frequencyLabels: Record<string, string> = {
  monthly: "Mensual",
  biweekly: "Quincenal",
  weekly: "Semanal",
  annual: "Anual",
};

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const claims = await requireAuth();
  if (!claims.tenantId) redirect("/dashboard");

  const flags = await getModuleFlags(claims.tenantId);
  if (isModuleRouteBlocked("/employees", flags)) redirect("/dashboard");

  const supabase = await createClient();
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_uid", claims.userId)
    .single();

  if (!currentUser) redirect("/login");

  const [ownProfile, teamView, adminView] = await Promise.all([
    can(currentUser.id, "ec.view_own_profile", "view", id),
    can(currentUser.id, "ec.view_team_profiles", "view", id),
    can(currentUser.id, "ec.manage_employees", "view", id),
  ]);

  if (!ownProfile.allowed && !teamView.allowed && !adminView.allowed) {
    return <AccessDenied />;
  }

  const { data: employee } = await supabase
    .from("users")
    .select("*, departments(name)")
    .eq("id", id)
    .single();

  if (!employee) notFound();

  const [
    { data: personalCurrent },
    { data: personalHistory },
    { data: jobCurrent },
    { data: jobHistory },
    { data: compCurrent },
    { data: compHistory },
  ] = await Promise.all([
    supabase
      .from("ec_personal_information")
      .select("*")
      .eq("user_id", id)
      .is("end_date", null)
      .single(),
    supabase
      .from("ec_personal_information")
      .select("*")
      .eq("user_id", id)
      .order("start_date", { ascending: false }),
    supabase
      .from("ec_job_information")
      .select(
        "*, positions(title, position_code), departments(name), job_classifications(title), locations(name), business_units(name), legal_entities(name)"
      )
      .eq("user_id", id)
      .is("end_date", null)
      .single(),
    supabase
      .from("ec_job_information")
      .select(
        "*, positions(title, position_code), departments(name), job_classifications(title), locations(name), business_units(name), legal_entities(name)"
      )
      .eq("user_id", id)
      .order("start_date", { ascending: false }),
    supabase
      .from("ec_compensation")
      .select("*")
      .eq("user_id", id)
      .is("end_date", null)
      .single(),
    supabase
      .from("ec_compensation")
      .select("*")
      .eq("user_id", id)
      .order("start_date", { ascending: false }),
  ]);

  let managerName = "—";
  if (jobCurrent?.manager_id) {
    const { data: mgr } = await supabase
      .from("users")
      .select("first_name, last_name")
      .eq("id", jobCurrent.manager_id)
      .single();
    if (mgr) managerName = `${mgr.first_name} ${mgr.last_name}`;
  }

  const canViewComp = adminView.allowed || teamView.allowed;

  function rel(obj: unknown): Record<string, string> | null {
    if (!obj) return null;
    if (Array.isArray(obj)) return (obj[0] as Record<string, string>) ?? null;
    return obj as Record<string, string>;
  }

  const personalHistoryRecords = (personalHistory ?? []).map((r) => ({
    id: r.id as string,
    start_date: r.start_date as string,
    end_date: r.end_date as string | null,
    event_reason: r.event_reason as string | null,
    fields: [
      { label: "Nombre", value: `${r.first_name} ${r.last_name}` },
      { label: "Teléfono", value: r.phone ?? "—" },
      { label: "Email personal", value: r.personal_email ?? "—" },
      { label: "Nacionalidad", value: r.nationality ?? "—" },
      { label: "Nacimiento", value: fmtDate(r.date_of_birth) },
      { label: "Género", value: r.gender ?? "—" },
      { label: "Estado civil", value: r.marital_status ?? "—" },
    ],
  }));

  const jobHistoryRecords = (jobHistory ?? []).map((r) => ({
    id: r.id as string,
    start_date: r.start_date as string,
    end_date: r.end_date as string | null,
    event_reason: r.event_reason as string | null,
    fields: [
      { label: "Puesto", value: r.job_title ?? "—" },
      { label: "Posición", value: rel(r.positions)?.title ?? "—" },
      { label: "Departamento", value: rel(r.departments)?.name ?? "—" },
      { label: "Clasificación", value: rel(r.job_classifications)?.title ?? "—" },
      { label: "Ubicación", value: rel(r.locations)?.name ?? "—" },
      { label: "Unidad de negocio", value: rel(r.business_units)?.name ?? "—" },
      { label: "Entidad legal", value: rel(r.legal_entities)?.name ?? "—" },
    ],
  }));

  const compHistoryRecords = (compHistory ?? []).map((r) => ({
    id: r.id as string,
    start_date: r.start_date as string,
    end_date: r.end_date as string | null,
    event_reason: r.event_reason as string | null,
    fields: [
      { label: "Salario base", value: fmtMoney(r.base_salary, r.currency) },
      { label: "Moneda", value: r.currency ?? "MXN" },
      { label: "Frecuencia", value: frequencyLabels[r.frequency] ?? r.frequency },
      { label: "Bono objetivo", value: r.bonus_target != null ? `${r.bonus_target}%` : "—" },
    ],
  }));

  const initials = `${(employee.first_name as string)?.[0] ?? ""}${(employee.last_name as string)?.[0] ?? ""}`.toUpperCase();

  const statusColors: Record<string, { bg: string; text: string }> = {
    ACTIVE: { bg: "bg-emerald-900/50", text: "text-emerald-400" },
    INACTIVE: { bg: "bg-slate-800", text: "text-slate-400" },
    ON_LEAVE: { bg: "bg-amber-900/50", text: "text-amber-400" },
    TERMINATED: { bg: "bg-red-900/50", text: "text-red-400" },
  };
  const statusStyle = statusColors[employee.status as string] ?? statusColors.INACTIVE;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600/20 text-lg font-bold text-indigo-400">
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              {employee.first_name} {employee.last_name}
            </h1>
            <p className="mt-0.5 text-sm text-slate-400">
              {jobCurrent?.job_title ?? "Sin puesto"} &middot;{" "}
              {rel(employee.departments)?.name ?? "Sin departamento"}
            </p>
          </div>
          <span
            className={`ml-2 self-start rounded-full px-3 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
          >
            {employee.status}
          </span>
        </div>
        {adminView.allowed && <ActionMenu employeeId={id} />}
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Información Personal
        </h2>
        {personalCurrent ? (
          <>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Nombre" value={personalCurrent.first_name} />
              <Field label="Apellido" value={personalCurrent.last_name} />
              <Field label="Email" value={employee.email as string} />
              <Field label="Teléfono" value={personalCurrent.phone ?? "—"} />
              <Field label="Email personal" value={personalCurrent.personal_email ?? "—"} />
              <Field label="Nacionalidad" value={personalCurrent.nationality ?? "—"} />
              <Field label="Fecha de nacimiento" value={fmtDate(personalCurrent.date_of_birth)} />
              <Field label="Género" value={personalCurrent.gender ?? "—"} />
              <Field label="Estado civil" value={personalCurrent.marital_status ?? "—"} />
              <Field label="CURP / ID Nacional" value={personalCurrent.national_id ?? "—"} />
              <Field label="RFC / Tax ID" value={personalCurrent.tax_id ?? "—"} />
              <Field label="IMSS" value={personalCurrent.imss_number ?? "—"} />
            </dl>
            {(personalCurrent.address_line1 || personalCurrent.city) && (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <h3 className="mb-3 text-sm font-medium text-slate-400">
                  Dirección
                </h3>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Calle" value={personalCurrent.address_line1 ?? "—"} />
                  <Field label="Calle 2" value={personalCurrent.address_line2 ?? "—"} />
                  <Field label="Ciudad" value={personalCurrent.city ?? "—"} />
                  <Field label="Estado" value={personalCurrent.state ?? "—"} />
                  <Field label="C.P." value={personalCurrent.postal_code ?? "—"} />
                  <Field label="País" value={personalCurrent.country ?? "—"} />
                </dl>
              </div>
            )}
            {personalCurrent.emergency_contact_name && (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <h3 className="mb-3 text-sm font-medium text-slate-400">
                  Contacto de emergencia
                </h3>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                  <Field label="Nombre" value={personalCurrent.emergency_contact_name ?? "—"} />
                  <Field label="Teléfono" value={personalCurrent.emergency_contact_phone ?? "—"} />
                </dl>
              </div>
            )}
            <EmployeeHistory
              records={personalHistoryRecords}
              label="información personal"
            />
          </>
        ) : (
          <p className="text-sm text-slate-500">
            Sin información personal registrada.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Información Laboral
        </h2>
        {jobCurrent ? (
          <>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Puesto" value={jobCurrent.job_title ?? "—"} />
              <Field
                label="Posición"
                value={
                  rel(jobCurrent.positions)
                    ? `${rel(jobCurrent.positions)!.title} (${rel(jobCurrent.positions)!.position_code})`
                    : "—"
                }
              />
              <Field label="Departamento" value={rel(jobCurrent.departments)?.name ?? "—"} />
              <Field label="Clasificación" value={rel(jobCurrent.job_classifications)?.title ?? "—"} />
              <Field label="Manager" value={managerName} />
              <Field label="Ubicación" value={rel(jobCurrent.locations)?.name ?? "—"} />
              <Field label="Unidad de negocio" value={rel(jobCurrent.business_units)?.name ?? "—"} />
              <Field label="Entidad legal" value={rel(jobCurrent.legal_entities)?.name ?? "—"} />
              <Field label="Fecha efectiva" value={fmtDate(jobCurrent.start_date)} />
              <Field label="Motivo" value={jobCurrent.event_reason ?? "—"} />
            </dl>
            <EmployeeHistory
              records={jobHistoryRecords}
              label="información laboral"
            />
          </>
        ) : (
          <p className="text-sm text-slate-500">
            Sin información laboral registrada.
          </p>
        )}
      </section>

      {canViewComp && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">
            Compensación
          </h2>
          {compCurrent ? (
            <>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label="Salario base"
                  value={fmtMoney(compCurrent.base_salary, compCurrent.currency)}
                />
                <Field label="Moneda" value={compCurrent.currency ?? "MXN"} />
                <Field
                  label="Frecuencia de pago"
                  value={frequencyLabels[compCurrent.frequency] ?? compCurrent.frequency}
                />
                <Field
                  label="Bono objetivo"
                  value={compCurrent.bonus_target != null ? `${compCurrent.bonus_target}%` : "—"}
                />
                <Field label="Grupo de pago" value={compCurrent.pay_group ?? "—"} />
                <Field label="Fecha efectiva" value={fmtDate(compCurrent.start_date)} />
                <Field label="Motivo" value={compCurrent.event_reason ?? "—"} />
              </dl>
              <EmployeeHistory
                records={compHistoryRecords}
                label="compensación"
              />
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Sin información de compensación registrada.
            </p>
          )}
        </section>
      )}
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
