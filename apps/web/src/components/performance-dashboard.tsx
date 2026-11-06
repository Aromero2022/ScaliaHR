"use client";

import { useState } from "react";
import Link from "next/link";
import PersonSearch from "@/components/person-search";
import { createGoal, sendFeedback } from "@/app/(protected)/performance/actions";
import { ENUM_LABELS, messages } from "@/lib/i18n/es-MX";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InputField, SelectField, TextareaField } from "@/components/ui/field";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";

// D42: dates arrive formatted by the server (dueLabel, createdLabel); this client component never formats them.
// D43: the goal and feedback forms are Dialogs; their success messages are toasts.

const t = messages.performance;

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  metric: string | null;
  target_value: number | null;
  actual_value: number | null;
  weight: number | null;
  status: string;
  dueLabel: string | null;
  progress_percentage: number;
  period_start: string;
  period_end: string;
}

interface FeedbackRow {
  id: string;
  content: string;
  visibility: string;
  category: string;
  createdLabel: string;
  author: { first_name: string; last_name: string } | null;
  subject: { first_name: string; last_name: string } | null;
  is_author: boolean;
}

interface Props {
  goals: GoalRow[];
  feedbacks: FeedbackRow[];
  feedbackTotal: number;
  feedbackPage: number;
  feedbackPageSize: number;
}

/** Progress ring and bar colors by goal state; the state's name is always shown as text (Badge). */
const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  NOT_STARTED: { color: "text-fg-muted", bg: "bg-surface-strong" },
  ON_TRACK: { color: "text-success-fg", bg: "bg-success" },
  AT_RISK: { color: "text-warning-fg", bg: "bg-warning" },
  COMPLETED: { color: "text-info-fg", bg: "bg-info" },
  CANCELLED: { color: "text-danger-fg", bg: "bg-danger" },
};

export default function PerformanceDashboard({ goals, feedbacks, feedbackTotal, feedbackPage, feedbackPageSize }: Props) {
  const [goalOpen, setGoalOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"goals" | "feedback">(feedbackPage > 1 ? "feedback" : "goals");
  const feedbackPages = Math.max(1, Math.ceil(feedbackTotal / feedbackPageSize));

  const avgProgress = goals.length
    ? Math.round(goals.reduce((sum, g) => sum + g.progress_percentage, 0) / goals.length)
    : 0;

  const onTrack = goals.filter((g) => g.status === "ON_TRACK").length;
  const atRisk = goals.filter((g) => g.status === "AT_RISK").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label={t.stats.goals} value={goals.length} tone="accent" />
        <StatCard label={t.stats.avgProgress} value={`${avgProgress}%`} tone="info" />
        <StatCard label={t.stats.onTrack} value={onTrack} tone="success" />
        <StatCard label={t.stats.atRisk} value={atRisk} tone="warning" />
      </div>

      <div className="flex items-center gap-2 border-b border-line">
        <button
          onClick={() => setActiveTab("goals")}
          aria-pressed={activeTab === "goals"}
          className={`min-h-11 px-4 py-2.5 text-sm font-medium transition ${
            activeTab === "goals" ? "border-b-2 border-accent text-accent-fg" : "text-fg-muted hover:text-fg"
          }`}
        >
          {t.tabs.goals(goals.length)}
        </button>
        <button
          onClick={() => setActiveTab("feedback")}
          aria-pressed={activeTab === "feedback"}
          className={`min-h-11 px-4 py-2.5 text-sm font-medium transition ${
            activeTab === "feedback" ? "border-b-2 border-accent text-accent-fg" : "text-fg-muted hover:text-fg"
          }`}
        >
          {t.tabs.feedback(feedbackTotal)}
        </button>
      </div>

      {activeTab === "goals" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setGoalOpen(true)}>{t.newGoal}</Button>
          </div>

          {goals.length === 0 ? (
            <EmptyState message={t.noGoals} />
          ) : (
            <div className="space-y-3">
              {goals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "feedback" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setFeedbackOpen(true)}>{t.sendFeedback}</Button>
          </div>

          {feedbacks.length === 0 ? (
            <EmptyState message={t.noFeedback} />
          ) : (
            <div className="space-y-3">
              {feedbacks.map((fb) => (
                <FeedbackCard key={fb.id} feedback={fb} />
              ))}
            </div>
          )}
          {feedbackPages > 1 && (
            <div className="flex items-center justify-between text-sm text-fg-muted">
              {feedbackPage > 1 ? (
                <Link href={`/performance?fb=${feedbackPage - 1}`} className="inline-flex min-h-11 items-center hover:text-fg">
                  {t.previous}
                </Link>
              ) : (
                <span />
              )}
              <span>
                {feedbackPage} / {feedbackPages}
              </span>
              {feedbackPage < feedbackPages ? (
                <Link href={`/performance?fb=${feedbackPage + 1}`} className="inline-flex min-h-11 items-center hover:text-fg">
                  {t.next}
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </div>
      )}

      <GoalDialog open={goalOpen} onClose={() => setGoalOpen(false)} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}

function ProgressRing({ percentage, status }: { percentage: number; status: string }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.NOT_STARTED;

  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
      <svg aria-hidden="true" className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="currentColor" strokeWidth="4" className="text-surface-strong" />
        <circle
          cx="32" cy="32" r={radius} fill="none"
          stroke="currentColor" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className={config.color}
        />
      </svg>
      <span className="absolute text-xs font-bold text-fg">{percentage}%</span>
    </div>
  );
}

function GoalCard({ goal }: { goal: GoalRow }) {
  const config = STATUS_CONFIG[goal.status] || STATUS_CONFIG.NOT_STARTED;

  return (
    <div className="flex items-start gap-4 rounded-xl border border-line bg-surface p-5">
      <ProgressRing percentage={goal.progress_percentage} status={goal.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium text-fg">{goal.title}</h3>
          <Badge enumName="GoalStatus" value={goal.status} className="shrink-0" />
        </div>
        {goal.description && (
          <p className="mt-1 text-sm text-fg-muted line-clamp-2">{goal.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
          {goal.metric && (
            <span>
              {t.goal.metric} <span className="text-fg-muted">{goal.metric}</span>
              {goal.target_value != null && t.goal.target(goal.target_value)}
              {goal.actual_value != null && t.goal.actual(goal.actual_value)}
            </span>
          )}
          {goal.weight != null && <span>{t.goal.weight(Math.round(goal.weight * 100))}</span>}
          {goal.dueLabel && <span>{t.goal.due(goal.dueLabel)}</span>}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-raised">
          <div
            className={`h-full rounded-full transition-all ${config.bg}`}
            style={{ width: `${Math.min(goal.progress_percentage, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function FeedbackCard({ feedback }: { feedback: FeedbackRow }) {
  const authorName = feedback.author ? `${feedback.author.first_name} ${feedback.author.last_name}` : t.feedback.unknown;
  const subjectName = feedback.subject ? `${feedback.subject.first_name} ${feedback.subject.last_name}` : t.feedback.unknown;

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge enumName="FeedbackCategory" value={feedback.category} />
          <Badge enumName="FeedbackVisibility" value={feedback.visibility} />
        </div>
        <span className="text-xs text-fg-subtle">{feedback.createdLabel}</span>
      </div>
      <p className="mt-3 text-sm text-fg-muted">{feedback.content}</p>
      <div className="mt-3 flex items-center gap-1 text-xs text-fg-subtle">
        {feedback.is_author ? (
          <span>
            {t.feedback.sentTo} <span className="text-fg-muted">{subjectName}</span>
          </span>
        ) : (
          <span>
            {t.feedback.from} <span className="text-fg-muted">{authorName}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-6 py-12 text-center">
      <p className="text-sm text-fg-subtle">{message}</p>
    </div>
  );
}

function GoalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = t.goalDialog;
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await createGoal(new FormData(e.currentTarget));
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
    toast.success(d.created);
  }

  return (
    <Dialog open={open} onClose={onClose} title={d.title}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <InputField label={d.fields.title} name="title" required />
        <TextareaField label={d.fields.description} name="description" rows={2} />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <InputField label={d.fields.metric} name="metric" placeholder={d.fields.metricPlaceholder} />
          <InputField label={d.fields.target} name="target_value" type="number" step="any" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <InputField label={d.fields.weight} name="weight" type="number" step="0.05" placeholder="0.25" />
          <InputField label={d.fields.start} name="period_start" type="date" required />
          <InputField label={d.fields.end} name="period_end" type="date" required />
        </div>
        <InputField label={d.fields.due} name="due_date" type="date" />
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-1">
          <Button type="submit" loading={pending} className="flex-1">
            {pending ? d.submitting : d.submit}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {messages.common.cancel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = t.feedbackDialog;
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await sendFeedback(new FormData(e.currentTarget));
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
    toast.success(d.sent);
  }

  return (
    <Dialog open={open} onClose={onClose} title={d.title}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <p className="mb-2 block text-sm font-medium text-fg-muted">
            {d.recipient}
            <span aria-hidden="true" className="text-danger-fg"> *</span>
          </p>
          <PersonSearch name="subject_id" label={d.recipientSearch} />
        </div>
        <TextareaField label={d.content} name="content" required rows={3} placeholder={d.contentPlaceholder} />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <SelectField label={d.visibility} name="visibility">
            {Object.entries(ENUM_LABELS.FeedbackVisibility).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField label={d.category} name="category">
            {Object.entries(ENUM_LABELS.FeedbackCategory).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-1">
          <Button type="submit" loading={pending} className="flex-1">
            {pending ? d.submitting : d.submit}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {messages.common.cancel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
