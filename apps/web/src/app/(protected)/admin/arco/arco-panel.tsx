"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { createArcoRequest, processArcoRequest, exportUserData } from "./actions";
import PersonSearch from "@/components/person-search";

type ArcoRow = {
  id: string;
  requestType: string;
  status: string;
  description: string;
  resolutionNotes: string | null;
  exportHash: string | null;
  dueDate: string;
  completedAt: string | null;
  createdAt: string;
  requesterName: string;
  subjectName: string;
  subjectEmail: string;
  subjectId: string;
};

const typeLabels: Record<string, { label: string; color: string }> = {
  acceso: { label: "Acceso", color: "bg-category-1-subtle text-category-1-fg" },
  rectificacion: { label: "Rectificación", color: "bg-warning-subtle text-warning-fg" },
  cancelacion: { label: "Cancelación", color: "bg-danger-subtle text-danger-fg" },
  oposicion: { label: "Oposición", color: "bg-category-2-subtle text-category-2-fg" },
};

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-warning-subtle text-warning-fg" },
  in_progress: { label: "En proceso", color: "bg-info-subtle text-info-fg" },
  completed: { label: "Completada", color: "bg-success-subtle text-success-fg" },
  rejected: { label: "Rechazada", color: "bg-danger-subtle text-danger-fg" },
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ArcoPanel({ requests }: { requests: ArcoRow[] }) {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ArcoRow | null>(null);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (showCreate) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [showCreate]);

  useEffect(() => {
    if (selectedRequest) detailRef.current?.showModal();
    else detailRef.current?.close();
  }, [selectedRequest]);

  function handleCreateSubmit(form: FormData) {
    setFeedback(null);
    startTransition(async () => {
      const result = await createArcoRequest({
        subjectId: form.get("subjectId") as string,
        requestType: form.get("requestType") as "acceso" | "rectificacion" | "cancelacion" | "oposicion",
        description: form.get("description") as string,
      });
      if (result.success) {
        setFeedback({ ok: true, msg: "Solicitud ARCO creada" });
        setTimeout(() => {
          setShowCreate(false);
          setFeedback(null);
        }, 1200);
      } else {
        setFeedback({ ok: false, msg: result.error });
      }
    });
  }

  function handleProcess(action: "approve" | "reject") {
    if (!selectedRequest) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await processArcoRequest({
        requestId: selectedRequest.id,
        action,
        resolutionNotes:
          action === "reject" ? "Rechazada por administrador" : "Procesada",
      });
      if (result.success) {
        setFeedback({
          ok: true,
          msg:
            action === "approve"
              ? "Solicitud procesada correctamente"
              : "Solicitud rechazada",
        });
        setTimeout(() => {
          setSelectedRequest(null);
          setFeedback(null);
        }, 1200);
      } else {
        setFeedback({ ok: false, msg: result.error });
      }
    });
  }

  function handleExport() {
    if (!selectedRequest) return;
    startTransition(async () => {
      const result = await exportUserData(selectedRequest.subjectId);
      if (result.success) {
        const blob = new Blob([result.data.json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `arco-export-${selectedRequest.subjectId}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setFeedback({
          ok: true,
          msg: `Exportado. SHA-256: ${result.data.hash.slice(0, 16)}…`,
        });
      } else {
        setFeedback({ ok: false, msg: result.error });
      }
    });
  }

  const pending = requests.filter((r) => r.status === "pending" || r.status === "in_progress");
  const resolved = requests.filter((r) => r.status === "completed" || r.status === "rejected");

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total" value={requests.length} color="text-fg" />
        <StatCard
          label="Pendientes"
          value={pending.length}
          color="text-warning-fg"
        />
        <StatCard
          label="Completadas"
          value={resolved.filter((r) => r.status === "completed").length}
          color="text-success-fg"
        />
        <StatCard
          label="Rechazadas"
          value={resolved.filter((r) => r.status === "rejected").length}
          color="text-danger-fg"
        />
      </div>

      {/* Actions bar */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover"
        >
          Nueva Solicitud ARCO
        </button>
      </div>

      {/* Pending requests */}
      {pending.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-fg">
            Solicitudes Pendientes
          </h2>
          <div className="space-y-3">
            {pending.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                onClick={() => setSelectedRequest(r)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Resolved requests */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          Historial de Solicitudes
        </h2>
        {resolved.length === 0 ? (
          <p className="text-sm text-fg-subtle">Sin solicitudes resueltas.</p>
        ) : (
          <div className="space-y-3">
            {resolved.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                onClick={() => setSelectedRequest(r)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Create dialog */}
      <dialog
        ref={dialogRef}
        onClick={(e) => e.target === dialogRef.current && setShowCreate(false)}
        onClose={() => setShowCreate(false)}
        className="m-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-overlay"
      >
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-fg">
              Nueva Solicitud ARCO
            </h2>
            <button
              onClick={() => setShowCreate(false)}
              className="text-fg-subtle hover:text-fg"
            >
              ✕
            </button>
          </div>

          {feedback && (
            <FeedbackBanner ok={feedback.ok} msg={feedback.msg} />
          )}

          <form action={handleCreateSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-subtle">
                Titular de los datos <span className="text-danger-fg">*</span>
              </span>
              <PersonSearch name="subjectId" label="Buscar titular de los datos" includeSelf showEmail />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-subtle">
                Tipo de derecho <span className="text-danger-fg">*</span>
              </span>
              <select
                name="requestType"
                required
                className="w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus"
              >
                <option value="">— Seleccionar —</option>
                <option value="acceso">Acceso — Consultar datos personales</option>
                <option value="rectificacion">Rectificación — Corregir datos inexactos</option>
                <option value="cancelacion">Cancelación — Eliminar datos personales</option>
                <option value="oposicion">Oposición — Oponerse al tratamiento</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-subtle">
                Descripción <span className="text-danger-fg">*</span>
              </span>
              <textarea
                name="description"
                required
                rows={3}
                className="w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus"
                placeholder="Detalle de la solicitud…"
              />
            </label>

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Creando…" : "Crear Solicitud"}
            </button>
          </form>
        </div>
      </dialog>

      {/* Detail dialog */}
      <dialog
        ref={detailRef}
        onClick={(e) =>
          e.target === detailRef.current && setSelectedRequest(null)
        }
        onClose={() => setSelectedRequest(null)}
        className="m-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-overlay"
      >
        {selectedRequest && (
          <div className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-fg">
                Detalle de Solicitud
              </h2>
              <button
                onClick={() => setSelectedRequest(null)}
                className="text-fg-subtle hover:text-fg"
              >
                ✕
              </button>
            </div>

            {feedback && (
              <FeedbackBanner ok={feedback.ok} msg={feedback.msg} />
            )}

            <dl className="space-y-3 text-sm">
              <DetailRow label="Tipo">
                <TypeBadge type={selectedRequest.requestType} />
              </DetailRow>
              <DetailRow label="Estado">
                <StatusBadge status={selectedRequest.status} />
              </DetailRow>
              <DetailRow label="Titular">
                {selectedRequest.subjectName} ({selectedRequest.subjectEmail})
              </DetailRow>
              <DetailRow label="Solicitante">
                {selectedRequest.requesterName}
              </DetailRow>
              <DetailRow label="Descripción">
                {selectedRequest.description}
              </DetailRow>
              <DetailRow label="Fecha límite">
                {fmtDate(selectedRequest.dueDate)}
              </DetailRow>
              <DetailRow label="Creada">
                {fmtDate(selectedRequest.createdAt)}
              </DetailRow>
              {selectedRequest.completedAt && (
                <DetailRow label="Resuelta">
                  {fmtDate(selectedRequest.completedAt)}
                </DetailRow>
              )}
              {selectedRequest.resolutionNotes && (
                <DetailRow label="Notas">
                  {selectedRequest.resolutionNotes}
                </DetailRow>
              )}
              {selectedRequest.exportHash && (
                <DetailRow label="Hash exportación">
                  <code className="break-all text-xs text-fg-muted">
                    {selectedRequest.exportHash}
                  </code>
                </DetailRow>
              )}
            </dl>

            {(selectedRequest.status === "pending" ||
              selectedRequest.status === "in_progress") && (
              <div className="mt-6 space-y-3">
                {selectedRequest.requestType === "acceso" && (
                  <button
                    onClick={handleExport}
                    disabled={isPending}
                    className="w-full rounded-lg border border-info-line bg-info-subtle px-4 py-2 text-sm font-medium text-info-fg transition hover:bg-surface-hover disabled:opacity-50"
                  >
                    {isPending ? "Exportando…" : "Exportar datos (JSON)"}
                  </button>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleProcess("approve")}
                    disabled={isPending}
                    className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-on-success transition hover:bg-success-hover disabled:opacity-50"
                  >
                    {isPending ? "Procesando…" : "Aprobar"}
                  </button>
                  <button
                    onClick={() => handleProcess("reject")}
                    disabled={isPending}
                    className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-on-danger transition hover:bg-danger-hover disabled:opacity-50"
                  >
                    {isPending ? "Procesando…" : "Rechazar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function RequestCard({
  request,
  onClick,
}: {
  request: ArcoRow;
  onClick: () => void;
}) {
  const isOverdue =
    (request.status === "pending" || request.status === "in_progress") &&
    new Date(request.dueDate) < new Date();

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg border border-line p-4 text-left transition hover:border-accent-line hover:bg-surface-hover"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <TypeBadge type={request.requestType} />
          <StatusBadge status={request.status} />
          {isOverdue && (
            <span className="rounded-full bg-danger-subtle px-2 py-0.5 text-xs font-medium text-danger-fg">
              Vencida
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-fg">
          {request.subjectName} — {request.description.slice(0, 80)}
          {request.description.length > 80 && "…"}
        </p>
        <p className="mt-0.5 text-xs text-fg-subtle">
          Solicitante: {request.requesterName} · Límite:{" "}
          {fmtDate(request.dueDate)}
        </p>
      </div>
      <svg
        className="ml-3 h-4 w-4 shrink-0 text-fg-subtle"
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
    </button>
  );
}

function TypeBadge({ type }: { type: string }) {
  const t = typeLabels[type] ?? { label: type, color: "bg-surface-raised text-fg-muted" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.color}`}>
      {t.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = statusLabels[status] ?? { label: status, color: "bg-surface-raised text-fg-muted" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-fg">{children}</dd>
    </div>
  );
}

function FeedbackBanner({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div
      className={`mb-4 rounded-lg px-4 py-2 text-sm ${
        ok
          ? "border border-success-line bg-success-subtle text-success-fg"
          : "border border-danger-line bg-danger-subtle text-danger-fg"
      }`}
    >
      {msg}
    </div>
  );
}
