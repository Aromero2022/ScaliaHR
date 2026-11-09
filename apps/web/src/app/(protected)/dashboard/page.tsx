import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { can } from "@/lib/authz/can";
import { getCurrentUser } from "@/lib/auth/current-user";
import { enumLabel, messages } from "@/lib/i18n/es-MX";
import { formatDateOnly } from "@/lib/format/dates";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { LoadError, PageLoadError } from "@/components/ui/load-error";
import { safeError } from "@/lib/errors/safe-error";
import { firstError, queryErrorMessage } from "@/lib/errors/query-error";

const t = messages.dashboard;
const fields = messages.fields;

export default async function DashboardPage() {
  const claims = await requireAuth();
  const supabase = await createClient();

  const bizUser = await getCurrentUser();

  // D45: the main query. maybeSingle: an account without an employee row is a
  // valid case and says so; a failed read is the page's error.
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("*, ec_job_information!ec_job_information_user_id_fkey(job_title, end_date), departments(name)")
    .eq("auth_uid", claims.userId)
    .maybeSingle();

  if (profileError) {
    return <PageLoadError title={messages.nav.dashboard.label} message={await safeError("dashboard.profile", profileError, messages.common.pageLoadError)} />;
  }
  if (!profile) {
    return (
      <div className="text-fg-muted">
        {t.noProfile}
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
  let kpiError: string | null = null;
  if (canViewTenantKpis) {
    const [empRes, deptRes] = await Promise.all([
      supabase.from("users").select("*", { count: "exact", head: true }).eq("status", "ACTIVE"),
      supabase.from("departments").select("*", { count: "exact", head: true }),
    ]);
    kpiError = await queryErrorMessage("dashboard.kpis", firstError(empRes.error, deptRes.error));
    totalEmployees = empRes.count;
    totalDepts = deptRes.count;
  }

  const { data: recentGoals, error: goalsQueryError } = await supabase
    .from("performance_goals")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(5);
  const goalsError = await queryErrorMessage("dashboard.goals", goalsQueryError);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-fg">
          {t.welcome(profile.first_name)}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {currentJob?.job_title ?? messages.common.noJobAssigned} &middot;{" "}
          {dept?.name ?? messages.common.noDepartment}
        </p>
      </div>

      {/* KPI Cards */}
      {kpiError && <LoadError message={kpiError} />}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
        {canViewTenantKpis && !kpiError && (
          <>
            <StatCard label={t.activeEmployees} value={totalEmployees ?? 0} tone="accent" />
            <StatCard label={t.departments} value={totalDepts ?? 0} tone="success" />
          </>
        )}
        <StatCard label={t.performanceScore} value={profile.performance_score ?? messages.common.empty} tone="warning" />
        <StatCard label={t.potentialScore} value={profile.potential_score ?? messages.common.empty} tone="category-2" />
      </div>

      {/* Profile Summary */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          {t.myInformation}
        </h2>
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-8 gap-y-4">
          <Field label={fields.fullName} value={`${profile.first_name} ${profile.last_name}`} />
          <Field label={fields.email} value={profile.email} />
          <Field label={fields.employeeNumber} value={profile.employee_id ?? messages.common.empty} />
          <Field label={fields.status} value={enumLabel("EmployeeStatus", profile.status)} />
          <Field label={fields.hireDate} value={formatDateOnly(profile.hire_date)} />
          <Field label={fields.jobTitle} value={currentJob?.job_title ?? messages.common.empty} />
          <Field label={fields.department} value={dept?.name ?? messages.common.empty} />
        </dl>
      </section>

      {/* Goals */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          {t.myGoals}
        </h2>
        {goalsError ? (
          <LoadError message={goalsError} />
        ) : recentGoals && recentGoals.length > 0 ? (
          <div className="space-y-3">
            {recentGoals.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-line px-4 py-3"
              >
                <div>
                  <p className="font-medium text-fg">{g.title}</p>
                  <p className="text-xs text-fg-subtle">
                    {formatDateOnly(g.period_start)} → {formatDateOnly(g.period_end)}
                  </p>
                </div>
                <Badge enumName="GoalStatus" value={g.status} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-subtle">
            {t.noGoals}
          </p>
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
      <dd className="mt-1 text-sm wrap-anywhere text-fg">{value}</dd>
    </div>
  );
}
