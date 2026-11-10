import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { enumLabel, messages } from "@/lib/i18n/es-MX";
import { formatDateOnly, formatInstant } from "@/lib/format/dates";
import { getSessionTimeZone } from "@/lib/tenant/get-tenant-time-zone";
import { Badge } from "@/components/ui/badge";
import { LoadError, PageLoadError } from "@/components/ui/load-error";
import { safeError } from "@/lib/errors/safe-error";
import { queryErrorMessage } from "@/lib/errors/query-error";

const t = messages.profile;
const fields = messages.fields;

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  // D45: the main query. maybeSingle: an account without an employee row is a
  // valid case and says so; a failed read is the page's error.
  const { data: profile, error: profileError } = await supabase
    .from("users")
    // D47: explicit columns; the talent scores come from talent_scores().
    .select("id, first_name, last_name, email, employee_id, status, hire_date, ec_job_information!ec_job_information_user_id_fkey(job_title, department_id, manager_id, start_date, end_date), departments(name)")
    .eq("auth_uid", authUser.id)
    .maybeSingle();

  if (profileError) {
    return <PageLoadError title={t.heading} message={await safeError("profile.profile", profileError, messages.common.pageLoadError)} />;
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
  ) as { job_title: string; department_id: string | null; manager_id: string | null } | undefined;
  const dept = Array.isArray(profile.departments) ? profile.departments[0] : profile.departments;

  const managerId = currentJob?.manager_id ?? null;
  let manager: { first_name: string; last_name: string } | null = null;
  let managerQueryError: unknown = null;
  if (managerId) {
    // maybeSingle: the manager may be out of the person's RLS view; the field says "Sin jefe".
    const { data, error } = await supabase
      .from("users")
      .select("first_name, last_name, email")
      .eq("id", managerId)
      .maybeSingle();
    manager = data;
    managerQueryError = error;
  }

  const { data: feedback, error: feedbackQueryError } = await supabase
    .from("continuous_feedbacks")
    .select("*")
    .eq("subject_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(10);

  // D47: own scores through talent_scores(); the columns are not readable by authenticated.
  const { data: scoreRows, error: scoresQueryError } = await supabase.rpc("talent_scores", { p_user_ids: [profile.id] });
  const scores = (scoreRows ?? [])[0] as { performance_score: number | null; potential_score: number | null } | undefined;

  // D45: the manager is a field of the personal data; each section shows its own error.
  const [personalError, feedbackError, scoresError] = await Promise.all([
    queryErrorMessage("profile.manager", managerQueryError),
    queryErrorMessage("profile.feedback", feedbackQueryError),
    queryErrorMessage("profile.scores", scoresQueryError),
  ]);

  const timeZone = await getSessionTimeZone();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-fg">{t.heading}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {t.subheading}
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
            {currentJob?.job_title ?? messages.common.noJob} &middot;{" "}
            {dept?.name ?? messages.common.noDepartment}
          </p>
        </div>
      </div>

      {/* Details card */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">{t.personalData}</h2>
        {personalError ? (
          <LoadError message={personalError} />
        ) : (
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-8 gap-y-4">
            <Field label={fields.email} value={profile.email} />
            <Field label={fields.employeeNumber} value={profile.employee_id ?? messages.common.empty} />
            <Field label={fields.status} value={enumLabel("EmployeeStatus", profile.status)} />
            <Field label={fields.hireDate} value={formatDateOnly(profile.hire_date)} />
            <Field
              label={fields.manager}
              value={
                manager
                  ? `${manager.first_name} ${manager.last_name}`
                  : fields.noManager
              }
            />
            <Field label={fields.department} value={dept?.name ?? messages.common.empty} />
          </dl>
        )}
      </section>

      {/* Job Info card */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          {t.jobInformation}
        </h2>
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-8 gap-y-4">
          <Field label={fields.title} value={currentJob?.job_title ?? messages.common.empty} />
          <Field label={fields.department} value={dept?.name ?? messages.common.empty} />
        </dl>
      </section>

      {/* 9-Box scores */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          {t.talentReview}
        </h2>
        {scoresError ? (
          <LoadError message={scoresError} />
        ) : (
          <div className="flex gap-12">
            <ScoreCircle label={t.performance} value={scores?.performance_score ?? null} />
            <ScoreCircle label={t.potential} value={scores?.potential_score ?? null} />
          </div>
        )}
      </section>

      {/* Feedback */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          {t.feedbackReceived}
        </h2>
        {feedbackError ? (
          <LoadError message={feedbackError} />
        ) : feedback && feedback.length > 0 ? (
          <ul className="space-y-3">
            {feedback.map((f) => (
              <li
                key={f.id}
                className="rounded-lg border border-line px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <Badge enumName="FeedbackCategory" value={f.category} />
                  <span className="text-xs text-fg-subtle">
                    {formatInstant(f.created_at, timeZone, { withTime: false })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{f.content}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-subtle">{t.noFeedback}</p>
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
        {value ?? messages.common.empty}
      </div>
      <p className="mt-2 text-xs font-medium text-fg-muted">{label}</p>
    </div>
  );
}
