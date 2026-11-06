"use client";

import { clsx } from "clsx";
import { useId, type ComponentProps, type ReactNode } from "react";

// D43: a form control with its label always visible (never a placeholder
// alone), and the hint and error tied to it with aria-describedby. Spacing
// from D19: label to control 8 px, control to help 4 px; forms put 20 px
// between fields (space-y-5).

type FieldText = { label: string; hint?: string; error?: string | null };

const CONTROL =
  "w-full rounded-lg border border-control bg-surface-raised px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-focus focus:ring-1 focus:ring-focus focus:outline-none aria-invalid:border-danger";

function useField({ hint, error }: Pick<FieldText, "hint" | "error">) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return { id, hintId, errorId, control: { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined } };
}

function Shell({ id, hintId, errorId, label, hint, error, required, children }: FieldText & { id: string; hintId: string; errorId: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-fg-muted">
        {label}
        {required && <span aria-hidden="true" className="text-danger-fg"> *</span>}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

export function InputField({ label, hint, error, className, ...input }: FieldText & ComponentProps<"input">) {
  const f = useField({ hint, error });
  return (
    <Shell id={f.id} hintId={f.hintId} errorId={f.errorId} label={label} hint={hint} error={error} required={input.required}>
      <input {...input} {...f.control} className={clsx(CONTROL, className)} />
    </Shell>
  );
}

export function SelectField({ label, hint, error, className, children, ...select }: FieldText & ComponentProps<"select">) {
  const f = useField({ hint, error });
  return (
    <Shell id={f.id} hintId={f.hintId} errorId={f.errorId} label={label} hint={hint} error={error} required={select.required}>
      <select {...select} {...f.control} className={clsx(CONTROL, className)}>
        {children}
      </select>
    </Shell>
  );
}

export function TextareaField({ label, hint, error, className, ...textarea }: FieldText & ComponentProps<"textarea">) {
  const f = useField({ hint, error });
  return (
    <Shell id={f.id} hintId={f.hintId} errorId={f.errorId} label={label} hint={hint} error={error} required={textarea.required}>
      <textarea {...textarea} {...f.control} className={clsx(CONTROL, className)} />
    </Shell>
  );
}
