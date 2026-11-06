import { enumLabel, type EnumName } from "@/lib/i18n/es-MX";
import type { ColorToken } from "@/lib/theme/tokens";

// D43: a stored state shown as a badge. Its text is always enumLabel(), so the
// state never depends on color alone (WCAG 1.4.1). Each tone is a text token
// on a subtle background; __tests__/ui/badge.test.ts checks that every tone is
// one of the D40 contrast pairs (validated in light, dark and high contrast).

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "category-1" | "category-2";

export const BADGE_TONES: Record<BadgeTone, { fg: ColorToken; bg: ColorToken; className: string }> = {
  neutral: { fg: "fg-muted", bg: "surface-raised", className: "bg-surface-raised text-fg-muted" },
  accent: { fg: "accent-fg", bg: "accent-subtle", className: "bg-accent-subtle text-accent-fg" },
  success: { fg: "success-fg", bg: "success-subtle", className: "bg-success-subtle text-success-fg" },
  warning: { fg: "warning-fg", bg: "warning-subtle", className: "bg-warning-subtle text-warning-fg" },
  danger: { fg: "danger-fg", bg: "danger-subtle", className: "bg-danger-subtle text-danger-fg" },
  info: { fg: "info-fg", bg: "info-subtle", className: "bg-info-subtle text-info-fg" },
  "category-1": { fg: "category-1-fg", bg: "category-1-subtle", className: "bg-category-1-subtle text-category-1-fg" },
  "category-2": { fg: "category-2-fg", bg: "category-2-subtle", className: "bg-category-2-subtle text-category-2-fg" },
};

/** The tone of each value, per enum; a value without one is neutral. */
export const ENUM_TONES: Partial<Record<EnumName, Record<string, BadgeTone>>> = {
  EmployeeStatus: { ACTIVE: "success", INACTIVE: "neutral", ON_LEAVE: "warning", TERMINATED: "danger" },
  GoalStatus: { NOT_STARTED: "neutral", ON_TRACK: "success", AT_RISK: "warning", COMPLETED: "accent", CANCELLED: "danger" },
  FeedbackCategory: { GENERAL: "neutral", RECOGNITION: "success", COACHING: "warning", DEVELOPMENT: "accent" },
  FeedbackVisibility: { PRIVATE: "neutral", MANAGER_ONLY: "neutral", PUBLIC: "neutral" },
  arco_request_type: { acceso: "category-1", rectificacion: "warning", cancelacion: "danger", oposicion: "category-2" },
  arco_request_status: { pending: "warning", in_progress: "info", completed: "success", rejected: "danger" },
};

export function badgeTone(enumName: EnumName, value: string | null | undefined): BadgeTone {
  return (value != null && ENUM_TONES[enumName]?.[value]) || "neutral";
}

export function Badge({ enumName, value, className }: { enumName: EnumName; value: string | null | undefined; className?: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[badgeTone(enumName, value)].className} ${className ?? ""}`}>
      {enumLabel(enumName, value)}
    </span>
  );
}
