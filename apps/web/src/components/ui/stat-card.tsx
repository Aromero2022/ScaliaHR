import type { ReactNode } from "react";

// D43: one card for a figure and its label (replaces the dashboard's KpiCard,
// the performance stat tile and ARCO's StatCard).

export type StatTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "category-2";

const BORDER: Record<StatTone, string> = {
  neutral: "border-line",
  accent: "border-accent-line",
  success: "border-success-line",
  warning: "border-warning-line",
  danger: "border-danger-line",
  info: "border-info-line",
  "category-2": "border-category-2-line",
};

const VALUE: Record<StatTone, string> = {
  neutral: "text-fg",
  accent: "text-accent-fg",
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
  info: "text-info-fg",
  "category-2": "text-category-2-fg",
};

export function StatCard({ label, value, tone = "neutral", icon }: { label: string; value: string | number; tone?: StatTone; icon?: ReactNode }) {
  return (
    <div className={`rounded-xl border bg-surface p-5 ${BORDER[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{label}</p>
        {icon && (
          <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised ${VALUE[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <p className={`mt-2 text-3xl font-bold ${VALUE[tone]}`}>{value}</p>
    </div>
  );
}
