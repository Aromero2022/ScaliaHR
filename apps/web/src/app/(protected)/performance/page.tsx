import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import { isModuleRouteBlocked } from "@/lib/tenant/module-guards";
import { can } from "@/lib/authz/can";
import { eqAnyOf } from "@/lib/postgrest/filters";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/access-denied";
import PerformanceDashboard from "@/components/performance-dashboard";
import { getCurrentUser } from "@/lib/auth/current-user";
import { z } from "zod";

// D38: the feedback list is paged; the recipient is searched, not listed.
const FEEDBACK_PAGE_SIZE = 20;
const Params = z.object({ fb: z.coerce.number().int().min(1).max(10_000).catch(1) });

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  metric: string | null;
  target_value: number | null;
  actual_value: number | null;
  weight: number | null;
  status: string;
  due_date: string | null;
  progress_percentage: number;
  period_start: string;
  period_end: string;
}

interface FeedbackDbRow {
  id: string;
  author_id: string;
  subject_id: string;
  content: string;
  visibility: string;
  category: string;
  created_at: string;
  author: { first_name: string; last_name: string }[] | { first_name: string; last_name: string } | null;
  subject: { first_name: string; last_name: string }[] | { first_name: string; last_name: string } | null;
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { fb: feedbackPage } = Params.parse(await searchParams);
  const claims = await requireAuth();
  if (!claims.tenantId) redirect("/dashboard");

  const flags = await getModuleFlags(claims.tenantId);
  if (isModuleRouteBlocked("/performance", flags)) redirect("/dashboard");

  const supabase = await createClient();

  const bizUser = await getCurrentUser();

  if (!bizUser) redirect("/login");

  const { allowed } = await can(bizUser.id, "pmgm.view_own_goals", "view");
  if (!allowed) return <AccessDenied />;

  const [goalsRes, feedbackRes] = await Promise.all([
    supabase
      .from("performance_goals")
      .select(
        "id, title, description, metric, target_value, actual_value, weight, status, due_date, progress_percentage, period_start, period_end"
      )
      .eq("user_id", bizUser.id)
      .order("period_end", { ascending: false }),
    supabase
      .from("continuous_feedbacks")
      .select(
        "id, author_id, subject_id, content, visibility, category, created_at, author:users!continuous_feedbacks_author_id_fkey(first_name, last_name), subject:users!continuous_feedbacks_subject_id_fkey(first_name, last_name)",
        { count: "exact" }
      )
      .or(eqAnyOf(["author_id", "subject_id"], bizUser.id))
      .order("created_at", { ascending: false })
      .range((feedbackPage - 1) * FEEDBACK_PAGE_SIZE, feedbackPage * FEEDBACK_PAGE_SIZE - 1),
  ]);

  const goals: GoalRow[] = (goalsRes.data ?? []).map((g) => ({
    id: g.id as string,
    title: g.title as string,
    description: g.description as string | null,
    metric: g.metric as string | null,
    target_value: g.target_value as number | null,
    actual_value: g.actual_value as number | null,
    weight: g.weight as number | null,
    status: g.status as string,
    due_date: g.due_date as string | null,
    progress_percentage: (g.progress_percentage as number) ?? 0,
    period_start: g.period_start as string,
    period_end: g.period_end as string,
  }));

  const feedbacks = (feedbackRes.data ?? []).map((f: unknown) => {
    const fb = f as FeedbackDbRow;
    const author = Array.isArray(fb.author) ? fb.author[0] : fb.author;
    const subject = Array.isArray(fb.subject) ? fb.subject[0] : fb.subject;
    return {
      id: fb.id,
      content: fb.content,
      visibility: fb.visibility,
      category: fb.category,
      created_at: fb.created_at,
      author: author ?? null,
      subject: subject ?? null,
      is_author: fb.author_id === bizUser.id,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Desempeño y Objetivos</h1>
        <p className="mt-1 text-sm text-fg-muted">
          PMGM — Gestiona tus objetivos SMART y da/recibe feedback continuo
        </p>
      </div>
      <PerformanceDashboard
        goals={goals}
        feedbacks={feedbacks}
        feedbackTotal={feedbackRes.count ?? feedbacks.length}
        feedbackPage={feedbackPage}
        feedbackPageSize={FEEDBACK_PAGE_SIZE}
      />
    </div>
  );
}
