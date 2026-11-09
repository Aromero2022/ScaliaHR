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
import { Badge } from "@/components/ui/badge";
import { LoadError, PageLoadError } from "@/components/ui/load-error";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeError } from "@/lib/errors/safe-error";
import { firstError, queryErrorMessage } from "@/lib/errors/query-error";
import { JOB_INFORMATION_SELECT, jobOrganization } from "@/lib/employees/job-information";
import { z } from "zod";

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

  // D45: the URL's id is external input; one that is not a uuid is not an
  // employee. guid, not uuid: the seed's ids (e0000000-…) are not RFC 4122.
  if (!z.guid().safeParse(id).success) notFound();

  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const [ownProfile, teamView, adminView] = await Promise.all([
    can(currentUser.id, "ec.view_own_profile", "view", id),
    can(currentUser.id, "ec.view_team_profiles", "view", id),
    can(currentUser.id, "ec.manage_employees", "view", id),
  ]);

  if (!ownProfile.allowed && !teamView.allowed && !adminView.allowed) {
    return <AccessDenied />;
  }

  const supabase = await createClient();
  // D45: the main query. No row (it does not exist or RLS hides it) is a 404;
  // a failed read is the whole page's error, with its request id.
  const { data: employee, error: employeeError } = await supabase
    .from("users")
    // D47: explicit columns; the talent scores are not readable by authenticated.
    .select("id, first_name, last_name, email, status, departments(name)")
    .eq("id", id)
    .maybeSingle();

  if (employeeError) {
    return <PageLoadError title={t.heading} message={await safeError("employee_detail.employee", employeeError, messages.common.pageLoadError)} />;
  }
  if (!employee) notFound();

  // D45: maybeSingle on the current records: an employee may have no current
  // personal, job or compensation record yet, and the section says so.
  const [
    { data: personalCurrent, error: personalCurrentError },
    { data: personalHistory, error: personalHistoryError },
    { data: jobCurrent, error: jobCurrentError },
    { data: jobHistory, error: jobHistoryError },
    { data: compCurrent, error: compCurrentError },
    { data: compHistory, error: compHistoryError },
  ] = await Promise.all([
    supabase
      .from("ec_personal_information")
      .select("*")
      .eq("user_id", id)
      .is("end_date", null)
      .maybeSingle(),
    supabase
      .from("ec_personal_information")
      .select("*")
      .eq("user_id", id)
      .order("start_date", { ascending: false }),
    supabase
      .from("ec_job_information")
      .select(JOB_INFORMATION_SELECT)
      .eq("user_id", id)
      .is("end_date", null)
      .maybeSingle(),
    supabase
      .from("ec_job_information")
      .select(JOB_INFORMATION_SELECT)
      .eq("user_id", id)
      .order("start_date", { ascending: false }),
    supabase
      .from("ec_compensation")
      .select("*")
      .eq("user_id", id)
      .is("end_date", null)
      .maybeSingle(),
    supabase
      .from("ec_compensation")
      .select("*")
      .eq("user_id", id)
      .order("start_date", { ascending: false }),
  ]);

  let managerName: string = empty;
  let managerError: unknown = null;
  if (jobCurrent?.manager_id) {
    // maybeSingle: the manager may be out of the caller's RLS view; the field shows "—".
    const { data: mgr, error } = await supabase
      .from("users")
      .select("first_name, last_name")
      .eq("id", jobCurrent.manager_id)
      .maybeSingle();
    managerError = error;
    if (mgr) managerName = `${mgr.first_name} ${mgr.last_name}`;
  }

  // D45: each section shows its own error; the others still render.
  const [personalError, jobError, compError] = await Promise.all([
    queryErrorMessage("employee_detail.personal", firstError(personalCurrentError, personalHistoryError)),
    queryErrorMessage("employee_detail.job", firstError(jobCurrentError, jobHistoryError, managerError)),
    queryErrorMessage("employee_detail.compensation", firstError(compCurrentError, compHistoryError)),
  ]);

  // D47: compensation has its own permission (Owner and HR Administrator for
  // everyone, Manager for direct reports), the same one its RLS policy reads.
  const canViewComp = (await can(currentUser.id, "ec.view_compensation", "view", id)).allowed;
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

  const jobHistoryRecords = (jobHistory ?? []).map((r) => {
    const org = jobOrganization(r);
    return {
      id: r.id as string,
      ...historyPeriod(r.start_date as string, r.end_date as string | null),
      eventReason: r.event_reason as string | null,
      fields: [
        { label: fields.jobTitle, value: r.job_title ?? empty },
        { label: fields.position, value: rel(r.positions)?.title ?? empty },
        { label: fields.department, value: org.department ?? empty },
        { label: fields.classification, value: rel(r.job_classifications)?.title ?? empty },
        { label: fields.location, value: rel(r.locations)?.name ?? empty },
        { label: fields.businessUnit, value: org.businessUnit ?? empty },
        { label: fields.legalEntity, value: org.legalEntity ?? empty },
      ],
    };
  });
  const jobCurrentOrg = jobCurrent ? jobOrganization(jobCurrent) : null;

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-subtle text-lg font-bold text-accent-fg">
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-fg">
              {employee.first_name} {employee.last_name}
            </h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              {/* D45: without the job record the header does not claim "Sin puesto"; the section shows the error. */}
              {!jobError && (
                <>
                  {jobCurrent?.job_title ?? messages.common.noJob} &middot;{" "}
                </>
              )}
              {rel(employee.departments)?.name ?? messages.common.noDepartment}
            </p>
          </div>
          <Badge enumName="EmployeeStatus" value={employee.status as string} className="ml-2 self-start" />
        </div>
        {adminView.allowed && <ActionMenu employeeId={id} today={today} />}
      </div>

      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          {t.personalInformation}
        </h2>
        {personalError ? (
          <LoadError message={personalError} />
        ) : personalCurrent ? (
          <>
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-8 gap-y-4">
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
                <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-8 gap-y-4">
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
                <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-8 gap-y-4">
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
        {jobError ? (
          <LoadError message={jobError} />
        ) : jobCurrent ? (
          <>
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-8 gap-y-4">
              <Field label={fields.jobTitle} value={jobCurrent.job_title ?? empty} />
              <Field
                label={fields.position}
                value={
                  rel(jobCurrent.positions)
                    ? `${rel(jobCurrent.positions)!.title} (${rel(jobCurrent.positions)!.position_code})`
                    : empty
                }
              />
              <Field label={fields.department} value={jobCurrentOrg?.department ?? empty} />
              <Field label={fields.classification} value={rel(jobCurrent.job_classifications)?.title ?? empty} />
              <Field label={fields.manager} value={managerName} />
              <Field label={fields.location} value={rel(jobCurrent.locations)?.name ?? empty} />
              <Field label={fields.businessUnit} value={jobCurrentOrg?.businessUnit ?? empty} />
              <Field label={fields.legalEntity} value={jobCurrentOrg?.legalEntity ?? empty} />
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
          {compError ? (
            <LoadError message={compError} />
          ) : compCurrent ? (
            <>
              <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-8 gap-y-4">
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
      <dd className="mt-1 text-sm wrap-anywhere text-fg">{value}</dd>
    </div>
  );
}
