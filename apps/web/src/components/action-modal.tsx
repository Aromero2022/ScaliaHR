"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import {
  createJobChange,
  createCompensationChange,
  createPersonalInfoChange,
} from "@/app/(protected)/employees/[id]/actions";

type SelectOption = { id: string; label: string };

type ActionModalProps = {
  employeeId: string;
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
};

type ActionType = "job" | "compensation" | "personal" | null;

export default function ActionModal({
  employeeId,
  employeeName,
  positions,
  departments,
  jobClassifications,
  managers,
  locations,
  currentPersonal,
}: ActionModalProps) {
  const [open, setOpen] = useState(false);
  const [actionType, setActionType] = useState<ActionType>(null);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      setActionType(null);
      setFeedback(null);
    }
  }, [open]);

  function close() {
    setOpen(false);
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) close();
  }

  async function handleJobSubmit(form: FormData) {
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
        setTimeout(close, 1200);
      } else {
        setFeedback({ ok: false, msg: result.error });
      }
    });
  }

  async function handleCompSubmit(form: FormData) {
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
        setTimeout(close, 1200);
      } else {
        setFeedback({ ok: false, msg: result.error });
      }
    });
  }

  async function handlePersonalSubmit(form: FormData) {
    setFeedback(null);
    startTransition(async () => {
      const result = await createPersonalInfoChange({
        userId: employeeId,
        startDate: form.get("startDate") as string,
        firstName: (form.get("firstName") as string) || currentPersonal?.firstName || "",
        lastName: (form.get("lastName") as string) || currentPersonal?.lastName || "",
        middleName: (form.get("middleName") as string) || undefined,
        phone: (form.get("phone") as string) || undefined,
        personalEmail: (form.get("personalEmail") as string) || undefined,
        addressLine1: (form.get("addressLine1") as string) || undefined,
        city: (form.get("city") as string) || undefined,
        state: (form.get("state") as string) || undefined,
        postalCode: (form.get("postalCode") as string) || undefined,
        country: (form.get("country") as string) || "MX",
        emergencyContactName: (form.get("emergencyContactName") as string) || undefined,
        emergencyContactPhone: (form.get("emergencyContactPhone") as string) || undefined,
        eventReason: form.get("eventReason") as string,
      });
      if (result.success) {
        setFeedback({ ok: true, msg: "Datos personales actualizados" });
        setTimeout(close, 1200);
      } else {
        setFeedback({ ok: false, msg: result.error });
      }
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover"
      >
        Tomar Acción
      </button>

      <dialog
        ref={dialogRef}
        onClick={handleBackdropClick}
        onClose={close}
        className="m-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-overlay"
      >
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-fg">
              Tomar Acción — {employeeName}
            </h2>
            <button onClick={close} className="text-fg-subtle hover:text-fg">
              ✕
            </button>
          </div>

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

          {!actionType && (
            <div className="space-y-2">
              <p className="mb-3 text-sm text-fg-muted">Seleccione el tipo de acción:</p>
              <ActionChoice
                label="Cambio de Puesto / Job Change"
                desc="Modificar posición, departamento, manager o ubicación"
                onClick={() => setActionType("job")}
              />
              <ActionChoice
                label="Cambio de Compensación"
                desc="Ajustar salario, frecuencia de pago o bono"
                onClick={() => setActionType("compensation")}
              />
              <ActionChoice
                label="Datos Personales"
                desc="Actualizar información personal, contacto de emergencia"
                onClick={() => setActionType("personal")}
              />
            </div>
          )}

          {actionType === "job" && (
            <form action={handleJobSubmit} className="space-y-4">
              <button
                type="button"
                onClick={() => setActionType(null)}
                className="text-xs text-accent-fg hover:underline"
              >
                ← Volver
              </button>
              <h3 className="font-medium text-fg">Cambio de Puesto</h3>
              <InputField name="startDate" label="Fecha Efectiva" type="date" defaultValue={today} required />
              <InputField name="jobTitle" label="Título del Puesto" required />
              <SelectField name="positionId" label="Posición" options={positions} />
              <SelectField name="departmentId" label="Departamento" options={departments} />
              <SelectField name="jobClassificationId" label="Clasificación" options={jobClassifications} />
              <SelectField name="managerId" label="Manager" options={managers} />
              <SelectField name="locationId" label="Ubicación" options={locations} />
              <InputField name="eventReason" label="Motivo" required />
              <SubmitButton pending={isPending} label="Registrar Cambio" />
            </form>
          )}

          {actionType === "compensation" && (
            <form action={handleCompSubmit} className="space-y-4">
              <button
                type="button"
                onClick={() => setActionType(null)}
                className="text-xs text-accent-fg hover:underline"
              >
                ← Volver
              </button>
              <h3 className="font-medium text-fg">Cambio de Compensación</h3>
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
              <SubmitButton pending={isPending} label="Registrar Cambio" />
            </form>
          )}

          {actionType === "personal" && (
            <form action={handlePersonalSubmit} className="space-y-4">
              <button
                type="button"
                onClick={() => setActionType(null)}
                className="text-xs text-accent-fg hover:underline"
              >
                ← Volver
              </button>
              <h3 className="font-medium text-fg">Datos Personales</h3>
              <InputField name="startDate" label="Fecha Efectiva" type="date" defaultValue={today} required />
              <div className="grid grid-cols-2 gap-3">
                <InputField name="firstName" label="Nombre" defaultValue={currentPersonal?.firstName} required />
                <InputField name="lastName" label="Apellido" defaultValue={currentPersonal?.lastName} required />
              </div>
              <InputField name="middleName" label="Segundo Nombre" defaultValue={currentPersonal?.middleName} />
              <InputField name="phone" label="Teléfono" defaultValue={currentPersonal?.phone} />
              <InputField name="personalEmail" label="Email Personal" type="email" defaultValue={currentPersonal?.personalEmail} />
              <InputField name="addressLine1" label="Dirección" defaultValue={currentPersonal?.addressLine1} />
              <div className="grid grid-cols-2 gap-3">
                <InputField name="city" label="Ciudad" defaultValue={currentPersonal?.city} />
                <InputField name="state" label="Estado" defaultValue={currentPersonal?.state} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <InputField name="postalCode" label="C.P." defaultValue={currentPersonal?.postalCode} />
                <InputField name="country" label="País" defaultValue={currentPersonal?.country ?? "MX"} />
              </div>
              <InputField name="emergencyContactName" label="Contacto de Emergencia" defaultValue={currentPersonal?.emergencyContactName} />
              <InputField name="emergencyContactPhone" label="Tel. Emergencia" defaultValue={currentPersonal?.emergencyContactPhone} />
              <InputField name="eventReason" label="Motivo" required />
              <SubmitButton pending={isPending} label="Guardar Cambios" />
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}

function ActionChoice({
  label,
  desc,
  onClick,
}: {
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col items-start rounded-lg border border-line p-4 text-left transition hover:border-accent-line hover:bg-surface-hover"
    >
      <span className="font-medium text-fg">{label}</span>
      <span className="mt-0.5 text-xs text-fg-muted">{desc}</span>
    </button>
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

function SubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Procesando…" : label}
    </button>
  );
}
