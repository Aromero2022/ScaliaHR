import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import { isModuleRouteBlocked } from "@/lib/tenant/module-guards";
import { can } from "@/lib/authz/can";
import { redirect } from "next/navigation";
import AccessDenied from "@/components/access-denied";
import PerformanceDashboard from "@/components/performance-dashboard";

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

export default async function PerformancePage() {
  const claims = await requireAuth();
  if (!claims.tenantId) redirect("/dashboard");

  const flags = await getModuleFlags(claims.tenantId);
  if (isModuleRouteBlocked("/performance", flags)) redirect("/dashboard");

  const supabase = await createClient();

  const { data: bizUser } = await supabase
    .from("users")
    .select("id, tenant_id")
    .eq("auth_uid", claims.userId)
    .single();

  if (!bizUser) redirect("/login");

  const { allowed } = await can(bizUser.id, "pmgm.view_own_goals", "view");
  if (!allowed) return <AccessDenied />;

  const [goalsRes, feedbackRes, colleaguesRes] = await Promise.all([
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
        "id, author_id, subject_id, content, visibility, category, created_at, author:users!continuous_feedbacks_author_id_fkey(first_name, last_name), subject:users!continuous_feedbacks_subject_id_fkey(first_name, last_name)"
      )
      .or(`author_id.eq.${bizUser.id},subject_id.eq.${bizUser.id}`)
      .order("created_at", { ascending: false }),
    supabase
      .from("users")
      .select("id, first_name, last_name")
      .neq("id", bizUser.id)
      .order("first_name"),
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

  const colleagues = (colleaguesRes.data ?? []).map((c) => ({
    id: c.id as string,
    first_name: c.first_name as string,
    last_name: c.last_name as string,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Desempeño y Objetivos</h1>
        <p className="mt-1 text-sm text-slate-400">
          PMGM — Gestiona tus objetivos SMART y da/recibe feedback continuo
        </p>
      </div>
      <PerformanceDashboard
        goals={goals}
        feedbacks={feedbacks}
        colleagues={colleagues}
      />
    </div>
  );
}
