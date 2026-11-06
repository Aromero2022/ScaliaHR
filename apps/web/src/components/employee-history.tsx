"use client";

import { useState } from "react";

type HistoryRecord = {
  id: string;
  start_date: string;
  end_date: string | null;
  event_reason: string | null;
  fields: { label: string; value: string }[];
};

export default function EmployeeHistory({
  records,
  label,
}: {
  records: HistoryRecord[];
  label: string;
}) {
  const [open, setOpen] = useState(false);

  if (records.length <= 1) return null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-medium text-accent-fg hover:text-fg transition"
      >
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 4.5l7.5 7.5-7.5 7.5"
          />
        </svg>
        Ver historial de {label} ({records.length} registros)
      </button>

      {open && (
        <div className="mt-4 relative ml-3 border-l-2 border-line pl-6 space-y-6">
          {records.map((r, idx) => (
            <div key={r.id} className="relative">
              <div className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-line bg-surface" />
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-medium text-fg-muted">
                  {r.start_date}
                  {r.end_date ? ` → ${r.end_date}` : ""}
                </span>
                {idx === 0 && !r.end_date && (
                  <span className="rounded-full bg-success-subtle px-2 py-0.5 text-xs font-medium text-success-fg">
                    Vigente
                  </span>
                )}
                {r.event_reason && (
                  <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-fg-muted">
                    {r.event_reason}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {r.fields.map((f) => (
                  <div key={f.label}>
                    <dt className="text-xs text-fg-subtle">{f.label}</dt>
                    <dd className="text-sm text-fg-muted">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
