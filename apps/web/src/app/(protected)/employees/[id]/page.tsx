import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import { isModuleRouteBlocked } from "@/lib/tenant/module-guards";
import { redirect, notFound } from "next/navigation";
import { can } from "@/lib/authz/can";
import AccessDenied from "@/components/access-denied";
import EmployeeHistory from "@/components/employee-history";
import ActionMenu from "./action-menu";
import { enumLabel, messages } from "@/lib/i18n/es-MX";
import { calendarDateIn, formatDateOnly } from "@/lib/format/dates";
import { getTenantTimeZone } from "@/lib/tenant/get-tenant-time-zone";

const t = messages.employeeDetail;
const fields = messages.fields;
const empty = messages.common.empty;

function fmtMoney(n: number | null | undefined, currency = "MXN"): string {
  if (n == null) return empty;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  }).format(n);
}

/** D42: the history shows calendar dates (start_date and end_date are `date`), formatted here on the server. */
function historyPeriod(start: string, end: string | null): { period: string; isCurrent: boolean } {
  return {
    period: end ? `${formatDateOnly(start)} → ${formatDateOnly(end)}` : formatDateOnly(start),
    isCurrent: end === null,
  };
}

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

  let managerName: string = empty;
  if (jobCurrent?.manager_id) {
    const { data: mgr } = await supabase
      .from("users")
      .select("first_name, last_name")
      .eq("id", jobCurrent.manager_id)
      .single();
    if (mgr) managerName = `${mgr.first_name} ${mgr.last_name}`;
  }

  const canViewComp = adminView.allowed || teamView.allowed;
  const today = calendarDateIn((await getTenantTimeZone(claims.tenantId)).timeZone);

  function rel(obj: unknown): Record<string, string> | null {
    if (!obj) return null;
    if (Array.isArray(obj)) return (obj[0] as Record<string, string>) ?? null;
    return obj as Record<string, string>;
  }

  const personalHistoryRecords = (personalHistory ?? []).map((r) => ({
    id: r.id as string,
    ...historyPeriod(r.start_date as string, r.end_date as string | null),
    eventReason: r.event_reason as string | null,
    fields: [
      { label: fields.firstName, value: `${r.first_name} ${r.last_name}` },
      { label: fields.phone, value: r.phone ?? empty },
      { label: fields.personalEmail, value: r.personal_email ?? empty },
      { label: fields.nationality, value: r.nationality ?? empty },
      { label: fields.birth, value: formatDateOnly(r.date_of_birth) },
      { label: fields.gender, value: r.gender ?? empty },
      { label: fields.maritalStatus, value: r.marital_status ?? empty },
    ],
  }));

  const jobHistoryRecords = (jobHistory ?? []).map((r) => ({
    id: r.id as string,
    ...historyPeriod(r.start_date as string, r.end_date as string | null),
    eventReason: r.event_reason as string | null,
    fields: [
      { label: fields.jobTitle, value: r.job_title ?? empty },
      { label: fields.position, value: rel(r.positions)?.title ?? empty },
      { label: fields.department, value: rel(r.departments)?.name ?? empty },
      { label: fields.classification, value: rel(r.job_classifications)?.title ?? empty },
      { label: fields.location, value: rel(r.locations)?.name ?? empty },
      { label: fields.businessUnit, value: rel(r.business_units)?.name ?? empty },
      { label: fields.legalEntity, value: rel(r.legal_entities)?.name ?? empty },
    ],
  }));

  const compHistoryRecords = (compHistory ?? []).map((r) => ({
    id: r.id as string,
    ...historyPeriod(r.start_date as string, r.end_date as string | null),
    eventReason: r.event_reason as string | null,
    fields: [
      { label: fields.baseSalary, value: fmtMoney(r.base_salary, r.currency) },
      { label: fields.currency, value: r.currency ?? "MXN" },
      { label: fields.frequency, value: enumLabel("pay_frequency", r.frequency) },
      { label: fields.bonusTarget, value: r.bonus_target != null ? `${r.bonus_target}%` : empty },
    ],
  }));

  const initials = `${(employee.first_name as string)?.[0] ?? ""}${(employee.last_name as string)?.[0] ?? ""}`.toUpperCase();

  const statusColors: Record<string, { bg: string; text: string }> = {
    ACTIVE: { bg: "bg-success-subtle", text: "text-success-fg" },
    INACTIVE: { bg: "bg-surface-raised", text: "text-fg-muted" },
    ON_LEAVE: { bg: "bg-warning-subtle", text: "text-warning-fg" },
    TERMINATED: { bg: "bg-danger-subtle", text: "text-danger-fg" },
  };
  const statusStyle = statusColors[employee.status as string] ?? statusColors.INACTIVE;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-subtle text-lg font-bold text-accent-fg">
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-fg">
              {employee.first_name} {employee.last_name}
            </h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              {jobCurrent?.job_title ?? messages.common.noJob} &middot;{" "}
              {rel(employee.departments)?.name ?? messages.common.noDepartment}
            </p>
          </div>
          <span
            className={`ml-2 self-start rounded-full px-3 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
          >
            {enumLabel("EmployeeStatus", employee.status as string)}
          </span>
        </div>
        {adminView.allowed && <ActionMenu employeeId={id} today={today} />}
      </div>

      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          {t.personalInformation}
        </h2>
        {personalCurrent ? (
          <>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={fields.firstName} value={personalCurrent.first_name} />
              <Field label={fields.lastName} value={personalCurrent.last_name} />
              <Field label={fields.email} value={employee.email as string} />
              <Field label={fields.phone} value={personalCurrent.phone ?? empty} />
              <Field label={fields.personalEmail} value={personalCurrent.personal_email ?? empty} />
              <Field label={fields.nationality} value={personalCurrent.nationality ?? empty} />
              <Field label={fields.birthDate} value={formatDateOnly(personalCurrent.date_of_birth)} />
              <Field label={fields.gender} value={personalCurrent.gender ?? empty} />
              <Field label={fields.maritalStatus} value={personalCurrent.marital_status ?? empty} />
              <Field label={fields.nationalId} value={personalCurrent.national_id ?? empty} />
              <Field label={fields.taxId} value={personalCurrent.tax_id ?? empty} />
              <Field label={fields.imss} value={personalCurrent.imss_number ?? empty} />
            </dl>
            {(personalCurrent.address_line1 || personalCurrent.city) && (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="mb-3 text-sm font-medium text-fg-muted">
                  {t.address}
                </h3>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={fields.street} value={personalCurrent.address_line1 ?? empty} />
                  <Field label={fields.street2} value={personalCurrent.address_line2 ?? empty} />
                  <Field label={fields.city} value={personalCurrent.city ?? empty} />
                  <Field label={fields.state} value={personalCurrent.state ?? empty} />
                  <Field label={fields.postalCode} value={personalCurrent.postal_code ?? empty} />
                  <Field label={fields.country} value={personalCurrent.country ?? empty} />
                </dl>
              </div>
            )}
            {personalCurrent.emergency_contact_name && (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="mb-3 text-sm font-medium text-fg-muted">
                  {t.emergencyContact}
                </h3>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                  <Field label={fields.firstName} value={personalCurrent.emergency_contact_name ?? empty} />
                  <Field label={fields.phone} value={personalCurrent.emergency_contact_phone ?? empty} />
                </dl>
              </div>
            )}
            <EmployeeHistory
              records={personalHistoryRecords}
              label={t.historyOf.personal}
            />
          </>
        ) : (
          <p className="text-sm text-fg-subtle">
            {t.noPersonalInformation}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          {t.jobInformation}
        </h2>
        {jobCurrent ? (
          <>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={fields.jobTitle} value={jobCurrent.job_title ?? empty} />
              <Field
                label={fields.position}
                value={
                  rel(jobCurrent.positions)
                    ? `${rel(jobCurrent.positions)!.title} (${rel(jobCurrent.positions)!.position_code})`
                    : empty
                }
              />
              <Field label={fields.department} value={rel(jobCurrent.departments)?.name ?? empty} />
              <Field label={fields.classification} value={rel(jobCurrent.job_classifications)?.title ?? empty} />
              <Field label={fields.manager} value={managerName} />
              <Field label={fields.location} value={rel(jobCurrent.locations)?.name ?? empty} />
              <Field label={fields.businessUnit} value={rel(jobCurrent.business_units)?.name ?? empty} />
              <Field label={fields.legalEntity} value={rel(jobCurrent.legal_entities)?.name ?? empty} />
              <Field label={fields.effectiveDate} value={formatDateOnly(jobCurrent.start_date)} />
              <Field label={fields.reason} value={jobCurrent.event_reason ?? empty} />
            </dl>
            <EmployeeHistory
              records={jobHistoryRecords}
              label={t.historyOf.job}
            />
          </>
        ) : (
          <p className="text-sm text-fg-subtle">
            {t.noJobInformation}
          </p>
        )}
      </section>

      {canViewComp && (
        <section className="rounded-xl border border-line bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-fg">
            {t.compensation}
          </h2>
          {compCurrent ? (
            <>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label={fields.baseSalary}
                  value={fmtMoney(compCurrent.base_salary, compCurrent.currency)}
                />
                <Field label={fields.currency} value={compCurrent.currency ?? "MXN"} />
                <Field
                  label={fields.payFrequency}
                  value={enumLabel("pay_frequency", compCurrent.frequency)}
                />
                <Field
                  label={fields.bonusTarget}
                  value={compCurrent.bonus_target != null ? `${compCurrent.bonus_target}%` : empty}
                />
                <Field label={fields.payGroup} value={compCurrent.pay_group ?? empty} />
                <Field label={fields.effectiveDate} value={formatDateOnly(compCurrent.start_date)} />
                <Field label={fields.reason} value={compCurrent.event_reason ?? empty} />
              </dl>
              <EmployeeHistory
                records={compHistoryRecords}
                label={t.historyOf.compensation}
              />
            </>
          ) : (
            <p className="text-sm text-fg-subtle">
              {t.noCompensation}
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
      <dt className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-fg">{value}</dd>
    </div>
  );
}
