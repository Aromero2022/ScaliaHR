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
  NOT_STARTED: { label: "Sin Iniciar", color: "text-slate-400", bg: "bg-slate-500" },
  ON_TRACK: { label: "En Curso", color: "text-emerald-400", bg: "bg-emerald-500" },
  AT_RISK: { label: "En Riesgo", color: "text-amber-400", bg: "bg-amber-500" },
  COMPLETED: { label: "Completado", color: "text-sky-400", bg: "bg-sky-500" },
  CANCELLED: { label: "Cancelado", color: "text-red-400", bg: "bg-red-500" },
};

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  GENERAL: { label: "General", color: "text-slate-400" },
  RECOGNITION: { label: "Reconocimiento", color: "text-emerald-400" },
  COACHING: { label: "Coaching", color: "text-amber-400" },
  DEVELOPMENT: { label: "Desarrollo", color: "text-indigo-400" },
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
        <StatTile label="Objetivos" value={goals.length} accent="indigo" />
        <StatTile label="Progreso Promedio" value={`${avgProgress}%`} accent="sky" />
        <StatTile label="En Curso" value={onTrack} accent="emerald" />
        <StatTile label="En Riesgo" value={atRisk} accent="amber" />
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-800">
        <button
          onClick={() => setActiveTab("goals")}
          className={`px-4 py-2.5 text-sm font-medium transition ${
            activeTab === "goals"
              ? "border-b-2 border-indigo-500 text-indigo-400"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Mis Objetivos ({goals.length})
        </button>
        <button
          onClick={() => setActiveTab("feedback")}
          className={`px-4 py-2.5 text-sm font-medium transition ${
            activeTab === "feedback"
              ? "border-b-2 border-indigo-500 text-indigo-400"
              : "text-slate-400 hover:text-slate-200"
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
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
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
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
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
            <div className="flex items-center justify-between text-sm text-slate-400">
              {feedbackPage > 1 ? (
                <Link href={`/performance?fb=${feedbackPage - 1}`} className="hover:text-white">← Anteriores</Link>
              ) : (
                <span />
              )}
              <span>
                {feedbackPage} / {feedbackPages}
              </span>
              {feedbackPage < feedbackPages ? (
                <Link href={`/performance?fb=${feedbackPage + 1}`} className="hover:text-white">Siguientes →</Link>
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

function StatTile({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  const bgClass = `bg-${accent}-600/20`;
  const textClass = `text-${accent}-400`;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
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
        <circle cx="32" cy="32" r={radius} fill="none" stroke="currentColor" strokeWidth="4" className="text-slate-800" />
        <circle
          cx="32" cy="32" r={radius} fill="none"
          stroke="currentColor" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className={config.color}
        />
      </svg>
      <span className="absolute text-xs font-bold text-white">{percentage}%</span>
    </div>
  );
}

function GoalCard({ goal }: { goal: GoalRow }) {
  const config = STATUS_CONFIG[goal.status] || STATUS_CONFIG.NOT_STARTED;
  const dueStr = goal.due_date
    ? new Date(goal.due_date).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <div className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <ProgressRing percentage={goal.progress_percentage} status={goal.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium text-white">{goal.title}</h3>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.color} bg-slate-800`}>
            {config.label}
          </span>
        </div>
        {goal.description && (
          <p className="mt-1 text-sm text-slate-400 line-clamp-2">{goal.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {goal.metric && (
            <span>
              Métrica: <span className="text-slate-300">{goal.metric}</span>
              {goal.target_value != null && ` — Objetivo: ${goal.target_value}`}
              {goal.actual_value != null && ` — Actual: ${goal.actual_value}`}
            </span>
          )}
          {goal.weight != null && <span>Peso: {Math.round(goal.weight * 100)}%</span>}
          {dueStr && <span>Vence: {dueStr}</span>}
        </div>
        {/* Progress Bar */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
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
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-medium ${catConfig.color}`}>
            {catConfig.label}
          </span>
          <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-medium text-slate-400">
            {feedback.visibility === "PUBLIC" ? "Público" : feedback.visibility === "MANAGER_ONLY" ? "Solo Gerente" : "Privado"}
          </span>
        </div>
        <span className="text-xs text-slate-500">{dateStr}</span>
      </div>
      <p className="mt-3 text-sm text-slate-300">{feedback.content}</p>
      <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
        {feedback.is_author ? (
          <span>Enviado a <span className="text-slate-300">{subjectName}</span></span>
        ) : (
          <span>De <span className="text-slate-300">{authorName}</span></span>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-6 py-12 text-center">
      <p className="text-sm text-slate-500">{message}</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white">Nuevo Objetivo</h3>

        {success ? (
          <div className="mt-6 rounded-lg bg-emerald-500/10 p-4 text-center">
            <p className="text-sm font-medium text-emerald-400">Objetivo creado correctamente</p>
            <button onClick={onClose} className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">
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
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={pending}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {pending ? "Guardando..." : "Crear Objetivo"}
              </button>
              <button type="button" onClick={onClose} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white">Enviar Feedback</h3>

        {success ? (
          <div className="mt-6 rounded-lg bg-emerald-500/10 p-4 text-center">
            <p className="text-sm font-medium text-emerald-400">Feedback enviado correctamente</p>
            <button onClick={onClose} className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">Destinatario *</label>
              <PersonSearch name="subject_id" label="Buscar destinatario" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Contenido *</label>
              <textarea
                name="content"
                required
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="Escribe tu feedback..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300">Visibilidad</label>
                <select
                  name="visibility"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                >
                  <option value="PRIVATE">Privado</option>
                  <option value="MANAGER_ONLY">Solo Gerente</option>
                  <option value="PUBLIC">Público</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">Categoría</label>
                <select
                  name="category"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                >
                  <option value="GENERAL">General</option>
                  <option value="RECOGNITION">Reconocimiento</option>
                  <option value="COACHING">Coaching</option>
                  <option value="DEVELOPMENT">Desarrollo</option>
                </select>
              </div>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={pending}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {pending ? "Enviando..." : "Enviar Feedback"}
              </button>
              <button type="button" onClick={onClose} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">
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
    "mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300">{label}</label>
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
