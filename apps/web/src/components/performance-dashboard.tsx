"use client";

import { useState } from "react";
import Link from "next/link";
import PersonSearch from "@/components/person-search";
import { createGoal, sendFeedback } from "@/app/(protected)/performance/actions";

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

interface FeedbackRow {
  id: string;
  content: string;
  visibility: string;
  category: string;
  created_at: string;
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

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  NOT_STARTED: { label: "Sin Iniciar", color: "text-fg-muted", bg: "bg-surface-strong" },
  ON_TRACK: { label: "En Curso", color: "text-success-fg", bg: "bg-success" },
  AT_RISK: { label: "En Riesgo", color: "text-warning-fg", bg: "bg-warning" },
  COMPLETED: { label: "Completado", color: "text-info-fg", bg: "bg-info" },
  CANCELLED: { label: "Cancelado", color: "text-danger-fg", bg: "bg-danger" },
};

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  GENERAL: { label: "General", color: "text-fg-muted" },
  RECOGNITION: { label: "Reconocimiento", color: "text-success-fg" },
  COACHING: { label: "Coaching", color: "text-warning-fg" },
  DEVELOPMENT: { label: "Desarrollo", color: "text-accent-fg" },
};

export default function PerformanceDashboard({ goals, feedbacks, feedbackTotal, feedbackPage, feedbackPageSize }: Props) {
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"goals" | "feedback">(feedbackPage > 1 ? "feedback" : "goals");
  const feedbackPages = Math.max(1, Math.ceil(feedbackTotal / feedbackPageSize));

  const avgProgress = goals.length
    ? Math.round(goals.reduce((sum, g) => sum + g.progress_percentage, 0) / goals.length)
    : 0;

  const onTrack = goals.filter((g) => g.status === "ON_TRACK").length;
  const atRisk = goals.filter((g) => g.status === "AT_RISK").length;
  const completed = goals.filter((g) => g.status === "COMPLETED").length;

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Objetivos" value={goals.length} tone="accent" />
        <StatTile label="Progreso Promedio" value={`${avgProgress}%`} tone="info" />
        <StatTile label="En Curso" value={onTrack} tone="success" />
        <StatTile label="En Riesgo" value={atRisk} tone="warning" />
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-line">
        <button
          onClick={() => setActiveTab("goals")}
          className={`px-4 py-2.5 text-sm font-medium transition ${
            activeTab === "goals"
              ? "border-b-2 border-accent text-accent-fg"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          Mis Objetivos ({goals.length})
        </button>
        <button
          onClick={() => setActiveTab("feedback")}
          className={`px-4 py-2.5 text-sm font-medium transition ${
            activeTab === "feedback"
              ? "border-b-2 border-accent text-accent-fg"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          Feedback Continuo ({feedbackTotal})
        </button>
      </div>

      {/* Goals Tab */}
      {activeTab === "goals" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowGoalModal(true)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover"
            >
              + Nuevo Objetivo
            </button>
          </div>

          {goals.length === 0 ? (
            <EmptyState message="No tienes objetivos registrados." />
          ) : (
            <div className="space-y-3">
              {goals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Feedback Tab */}
      {activeTab === "feedback" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowFeedbackModal(true)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover"
            >
              + Enviar Feedback
            </button>
          </div>

          {feedbacks.length === 0 ? (
            <EmptyState message="No hay feedback registrado." />
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
                <Link href={`/performance?fb=${feedbackPage - 1}`} className="hover:text-fg">← Anteriores</Link>
              ) : (
                <span />
              )}
              <span>
                {feedbackPage} / {feedbackPages}
              </span>
              {feedbackPage < feedbackPages ? (
                <Link href={`/performance?fb=${feedbackPage + 1}`} className="hover:text-fg">Siguientes →</Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </div>
      )}

      {showGoalModal && <GoalModal onClose={() => setShowGoalModal(false)} />}
      {showFeedbackModal && (
        <FeedbackModal onClose={() => setShowFeedbackModal(false)} />
      )}
    </div>
  );
}

const STAT_TONE = {
  accent: "text-accent-fg",
  info: "text-info-fg",
  success: "text-success-fg",
  warning: "text-warning-fg",
} as const;

function StatTile({ label, value, tone }: { label: string; value: number | string; tone: keyof typeof STAT_TONE }) {
  const textClass = STAT_TONE[tone];
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${textClass}`}>{value}</p>
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
      <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
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
  const dueStr = goal.due_date
    ? new Date(goal.due_date).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <div className="flex items-start gap-4 rounded-xl border border-line bg-surface p-5">
      <ProgressRing percentage={goal.progress_percentage} status={goal.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium text-fg">{goal.title}</h3>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.color} bg-surface-raised`}>
            {config.label}
          </span>
        </div>
        {goal.description && (
          <p className="mt-1 text-sm text-fg-muted line-clamp-2">{goal.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
          {goal.metric && (
            <span>
              Métrica: <span className="text-fg-muted">{goal.metric}</span>
              {goal.target_value != null && ` — Objetivo: ${goal.target_value}`}
              {goal.actual_value != null && ` — Actual: ${goal.actual_value}`}
            </span>
          )}
          {goal.weight != null && <span>Peso: {Math.round(goal.weight * 100)}%</span>}
          {dueStr && <span>Vence: {dueStr}</span>}
        </div>
        {/* Progress Bar */}
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
  const catConfig = CATEGORY_CONFIG[feedback.category] || CATEGORY_CONFIG.GENERAL;
  const authorName = feedback.author
    ? `${feedback.author.first_name} ${feedback.author.last_name}`
    : "Desconocido";
  const subjectName = feedback.subject
    ? `${feedback.subject.first_name} ${feedback.subject.last_name}`
    : "Desconocido";
  const dateStr = new Date(feedback.created_at).toLocaleDateString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-full bg-surface-raised px-2.5 py-0.5 text-[10px] font-medium ${catConfig.color}`}>
            {catConfig.label}
          </span>
          <span className="rounded-full bg-surface-raised px-2.5 py-0.5 text-[10px] font-medium text-fg-muted">
            {feedback.visibility === "PUBLIC" ? "Público" : feedback.visibility === "MANAGER_ONLY" ? "Solo Gerente" : "Privado"}
          </span>
        </div>
        <span className="text-xs text-fg-subtle">{dateStr}</span>
      </div>
      <p className="mt-3 text-sm text-fg-muted">{feedback.content}</p>
      <div className="mt-3 flex items-center gap-1 text-xs text-fg-subtle">
        {feedback.is_author ? (
          <span>Enviado a <span className="text-fg-muted">{subjectName}</span></span>
        ) : (
          <span>De <span className="text-fg-muted">{authorName}</span></span>
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

function GoalModal({ onClose }: { onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const result = await createGoal(fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-fg">Nuevo Objetivo</h3>

        {success ? (
          <div className="mt-6 rounded-lg bg-success-subtle p-4 text-center">
            <p className="text-sm font-medium text-success-fg">Objetivo creado correctamente</p>
            <button onClick={onClose} className="mt-4 rounded-lg bg-surface-raised px-4 py-2 text-sm text-fg-muted hover:bg-surface-hover">
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <Field label="Título *" name="title" required />
            <Field label="Descripción" name="description" textarea />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Métrica" name="metric" placeholder="Ej. Días promedio" />
              <Field label="Valor Objetivo" name="target_value" type="number" step="any" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Peso (0-1)" name="weight" type="number" step="0.05" placeholder="0.25" />
              <Field label="Fecha Inicio *" name="period_start" type="date" required />
              <Field label="Fecha Fin *" name="period_end" type="date" required />
            </div>
            <Field label="Fecha Límite" name="due_date" type="date" />
            {error && <p className="text-sm text-danger-fg">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={pending}
                className="flex-1 rounded-lg bg-accent py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:opacity-50"
              >
                {pending ? "Guardando..." : "Crear Objetivo"}
              </button>
              <button type="button" onClick={onClose} className="rounded-lg bg-surface-raised px-4 py-2 text-sm text-fg-muted hover:bg-surface-hover">
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const result = await sendFeedback(fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-fg">Enviar Feedback</h3>

        {success ? (
          <div className="mt-6 rounded-lg bg-success-subtle p-4 text-center">
            <p className="text-sm font-medium text-success-fg">Feedback enviado correctamente</p>
            <button onClick={onClose} className="mt-4 rounded-lg bg-surface-raised px-4 py-2 text-sm text-fg-muted hover:bg-surface-hover">
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-fg-muted">Destinatario *</label>
              <PersonSearch name="subject_id" label="Buscar destinatario" />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-muted">Contenido *</label>
              <textarea
                name="content"
                required
                rows={3}
                className="mt-1 w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-focus focus:ring-1 focus:ring-focus"
                placeholder="Escribe tu feedback..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-fg-muted">Visibilidad</label>
                <select
                  name="visibility"
                  className="mt-1 w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg outline-none focus:border-focus"
                >
                  <option value="PRIVATE">Privado</option>
                  <option value="MANAGER_ONLY">Solo Gerente</option>
                  <option value="PUBLIC">Público</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-fg-muted">Categoría</label>
                <select
                  name="category"
                  className="mt-1 w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg outline-none focus:border-focus"
                >
                  <option value="GENERAL">General</option>
                  <option value="RECOGNITION">Reconocimiento</option>
                  <option value="COACHING">Coaching</option>
                  <option value="DEVELOPMENT">Desarrollo</option>
                </select>
              </div>
            </div>
            {error && <p className="text-sm text-danger-fg">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={pending}
                className="flex-1 rounded-lg bg-accent py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:opacity-50"
              >
                {pending ? "Enviando..." : "Enviar Feedback"}
              </button>
              <button type="button" onClick={onClose} className="rounded-lg bg-surface-raised px-4 py-2 text-sm text-fg-muted hover:bg-surface-hover">
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  textarea,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  textarea?: boolean;
  step?: string;
}) {
  const cls =
    "mt-1 w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-focus focus:ring-1 focus:ring-focus";
  return (
    <div>
      <label className="block text-sm font-medium text-fg-muted">{label}</label>
      {textarea ? (
        <textarea name={name} rows={2} className={cls} placeholder={placeholder} />
      ) : (
        <input
          type={type}
          name={name}
          required={required}
          placeholder={placeholder}
          step={step}
          className={cls}
        />
      )}
    </div>
  );
}
