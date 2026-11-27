"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { PersonalInfoSteps } from "@/components/personal-info-steps";
import {
  createJobChange,
  createCompensationChange,
} from "@/app/(protected)/employees/[id]/actions";

type SelectOption = { id: string; label: string };

type ActionModalProps = {
  employeeId: string;
  /** D42: today's date (YYYY-MM-DD) in the tenant's time zone, from the server. */
  today: string;
  employeeName: string;
  positions: SelectOption[];
  departments: SelectOption[];
  jobClassifications: SelectOption[];
  managers: SelectOption[];
  locations: SelectOption[];
  currentPersonal: {
    firstName: string;
    lastName: string;
    middleName?: string;
    phone?: string;
    personalEmail?: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
  } | null;
  /** D45: the lists could not be loaded; the dialog shows this and no form can be sent. */
  loadError?: string | null;
};

export type ActionKind = "job" | "compensation" | "personal";

/** 9c PR 6a: the menu's options and the dialog's titles. */
export const ACTION_TITLES: Record<ActionKind, string> = {
  job: "Cambio de puesto",
  compensation: "Cambio de compensación",
  personal: "Actualizar información personal",
};

/**
 * 9c PR 6a: one "Tomar Acción" button. The menu picks the action and this
 * dialog (the Dialog of D43) opens on that form; it has no button of its own
 * and no second choice of type. `action` null keeps it closed.
 */
export default function ActionModal({
  action,
  onClose,
  employeeName,
  ...form
}: ActionModalProps & { action: ActionKind | null; onClose: () => void }) {
  const title = action ? (employeeName ? `${ACTION_TITLES[action]} — ${employeeName}` : ACTION_TITLES[action]) : "";
  return (
    <Dialog open={action !== null} onClose={onClose} title={title}>
      {action && <ActionForm action={action} onDone={onClose} {...form} />}
    </Dialog>
  );
}

/** Rendered only while the dialog is open, so each opening starts without feedback. */
function ActionForm({
  action,
  onDone,
  employeeId,
  today,
  positions,
  departments,
  jobClassifications,
  managers,
  locations,
  currentPersonal,
  loadError = null,
}: Omit<ActionModalProps, "employeeName"> & { action: ActionKind; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleJobSubmit(form: FormData) {
    if (loadError) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await createJobChange({
        userId: employeeId,
        startDate: form.get("startDate") as string,
        jobTitle: form.get("jobTitle") as string,
        positionId: (form.get("positionId") as string) || undefined,
        departmentId: (form.get("departmentId") as string) || undefined,
        jobClassificationId: (form.get("jobClassificationId") as string) || undefined,
        managerId: (form.get("managerId") as string) || undefined,
        locationId: (form.get("locationId") as string) || undefined,
        eventReason: form.get("eventReason") as string,
      });
      if (result.success) {
        setFeedback({ ok: true, msg: "Cambio de puesto registrado" });
        setTimeout(onDone, 1200);
      } else {
        setFeedback({ ok: false, msg: result.error });
      }
    });
  }

  async function handleCompSubmit(form: FormData) {
    if (loadError) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await createCompensationChange({
        userId: employeeId,
        startDate: form.get("startDate") as string,
        baseSalary: Number(form.get("baseSalary")),
        currency: (form.get("currency") as "MXN" | "USD") || "MXN",
        payFrequency: (form.get("payFrequency") as "monthly" | "biweekly" | "weekly" | "annual") || "monthly",
        bonusTargetPct: form.get("bonusTargetPct") ? Number(form.get("bonusTargetPct")) : undefined,
        eventReason: form.get("eventReason") as string,
      });
      if (result.success) {
        setFeedback({ ok: true, msg: "Cambio de compensación registrado" });
        setTimeout(onDone, 1200);
      } else {
        setFeedback({ ok: false, msg: result.error });
      }
    });
  }

  return (
    <>
      {loadError && (
        <div role="alert" className="mb-4 rounded-lg border border-danger-line bg-danger-subtle px-4 py-2 text-sm text-danger-fg">
          {loadError}
        </div>
      )}

      {feedback && (
        <div
          className={`mb-4 rounded-lg px-4 py-2 text-sm ${
            feedback.ok
              ? "border border-success-line bg-success-subtle text-success-fg"
              : "border border-danger-line bg-danger-subtle text-danger-fg"
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {action === "job" && (
        <form action={handleJobSubmit} className="space-y-4">
          <InputField name="startDate" label="Fecha Efectiva" type="date" defaultValue={today} required />
          <InputField name="jobTitle" label="Título del Puesto" required />
          <SelectField name="positionId" label="Posición" options={positions} />
          <SelectField name="departmentId" label="Departamento" options={departments} />
          <SelectField name="jobClassificationId" label="Clasificación" options={jobClassifications} />
          <SelectField name="managerId" label="Manager" options={managers} />
          <SelectField name="locationId" label="Ubicación" options={locations} />
          <InputField name="eventReason" label="Motivo" required />
          <SubmitButton pending={isPending} blocked={!!loadError} label="Registrar Cambio" />
        </form>
      )}

      {action === "compensation" && (
        <form action={handleCompSubmit} className="space-y-4">
          <InputField name="startDate" label="Fecha Efectiva" type="date" defaultValue={today} required />
          <InputField name="baseSalary" label="Salario Base" type="number" required />
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              name="currency"
              label="Moneda"
              options={[
                { id: "MXN", label: "MXN" },
                { id: "USD", label: "USD" },
              ]}
              defaultValue="MXN"
            />
            <SelectField
              name="payFrequency"
              label="Frecuencia"
              options={[
                { id: "monthly", label: "Mensual" },
                { id: "biweekly", label: "Quincenal" },
                { id: "weekly", label: "Semanal" },
                { id: "annual", label: "Anual" },
              ]}
              defaultValue="monthly"
            />
          </div>
          <InputField name="bonusTargetPct" label="Bono Objetivo (%)" type="number" />
          <InputField name="eventReason" label="Motivo" required />
          <SubmitButton pending={isPending} blocked={!!loadError} label="Registrar Cambio" />
        </form>
      )}

      {action === "personal" && (
        // 9c PR 6d: a long form, in steps (D51).
        <PersonalInfoSteps employeeId={employeeId} today={today} current={currentPersonal} blocked={!!loadError} onDone={onDone} />
      )}
    </>
  );
}

function InputField({
  name,
  label,
  type = "text",
  required,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
        {required && <span className="text-danger-fg"> *</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        step={type === "number" ? "0.01" : undefined}
        className="w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus"
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: { id: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus"
      >
        <option value="">— Seleccionar —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubmitButton({ pending, blocked, label }: { pending: boolean; blocked: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending || blocked}
      className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Procesando…" : label}
    </button>
  );
}
