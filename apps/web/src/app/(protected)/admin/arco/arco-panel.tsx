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
  acceso: { label: "Acceso", color: "bg-blue-900/50 text-blue-400" },
  rectificacion: { label: "Rectificación", color: "bg-amber-900/50 text-amber-400" },
  cancelacion: { label: "Cancelación", color: "bg-red-900/50 text-red-400" },
  oposicion: { label: "Oposición", color: "bg-purple-900/50 text-purple-400" },
};

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-amber-900/50 text-amber-400" },
  in_progress: { label: "En proceso", color: "bg-blue-900/50 text-blue-400" },
  completed: { label: "Completada", color: "bg-emerald-900/50 text-emerald-400" },
  rejected: { label: "Rechazada", color: "bg-red-900/50 text-red-400" },
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
        <StatCard label="Total" value={requests.length} color="text-white" />
        <StatCard
          label="Pendientes"
          value={pending.length}
          color="text-amber-400"
        />
        <StatCard
          label="Completadas"
          value={resolved.filter((r) => r.status === "completed").length}
          color="text-emerald-400"
        />
        <StatCard
          label="Rechazadas"
          value={resolved.filter((r) => r.status === "rejected").length}
          color="text-red-400"
        />
      </div>

      {/* Actions bar */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          Nueva Solicitud ARCO
        </button>
      </div>

      {/* Pending requests */}
      {pending.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">
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
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Historial de Solicitudes
        </h2>
        {resolved.length === 0 ? (
          <p className="text-sm text-slate-500">Sin solicitudes resueltas.</p>
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
        className="m-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-0 text-slate-200 shadow-2xl backdrop:bg-black/60"
      >
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Nueva Solicitud ARCO
            </h2>
            <button
              onClick={() => setShowCreate(false)}
              className="text-slate-500 hover:text-slate-300"
            >
              ✕
            </button>
          </div>

          {feedback && (
            <FeedbackBanner ok={feedback.ok} msg={feedback.msg} />
          )}

          <form action={handleCreateSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
                Titular de los datos <span className="text-red-400">*</span>
              </span>
              <PersonSearch name="subjectId" label="Buscar titular de los datos" includeSelf showEmail />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
                Tipo de derecho <span className="text-red-400">*</span>
              </span>
              <select
                name="requestType"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">— Seleccionar —</option>
                <option value="acceso">Acceso — Consultar datos personales</option>
                <option value="rectificacion">Rectificación — Corregir datos inexactos</option>
                <option value="cancelacion">Cancelación — Eliminar datos personales</option>
                <option value="oposicion">Oposición — Oponerse al tratamiento</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
                Descripción <span className="text-red-400">*</span>
              </span>
              <textarea
                name="description"
                required
                rows={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Detalle de la solicitud…"
              />
            </label>

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
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
        className="m-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-0 text-slate-200 shadow-2xl backdrop:bg-black/60"
      >
        {selectedRequest && (
          <div className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Detalle de Solicitud
              </h2>
              <button
                onClick={() => setSelectedRequest(null)}
                className="text-slate-500 hover:text-slate-300"
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
                  <code className="break-all text-xs text-slate-400">
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
                    className="w-full rounded-lg border border-blue-700 bg-blue-900/30 px-4 py-2 text-sm font-medium text-blue-400 transition hover:bg-blue-900/50 disabled:opacity-50"
                  >
                    {isPending ? "Exportando…" : "Exportar datos (JSON)"}
                  </button>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleProcess("approve")}
                    disabled={isPending}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {isPending ? "Procesando…" : "Aprobar"}
                  </button>
                  <button
                    onClick={() => handleProcess("reject")}
                    disabled={isPending}
                    className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
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
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
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
      className="flex w-full items-center justify-between rounded-lg border border-slate-700 p-4 text-left transition hover:border-indigo-600/50 hover:bg-slate-800"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <TypeBadge type={request.requestType} />
          <StatusBadge status={request.status} />
          {isOverdue && (
            <span className="rounded-full bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-400">
              Vencida
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-200">
          {request.subjectName} — {request.description.slice(0, 80)}
          {request.description.length > 80 && "…"}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Solicitante: {request.requesterName} · Límite:{" "}
          {fmtDate(request.dueDate)}
        </p>
      </div>
      <svg
        className="ml-3 h-4 w-4 shrink-0 text-slate-600"
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
  const t = typeLabels[type] ?? { label: type, color: "bg-slate-800 text-slate-400" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.color}`}>
      {t.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = statusLabels[status] ?? { label: status, color: "bg-slate-800 text-slate-400" };
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
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-200">{children}</dd>
    </div>
  );
}

function FeedbackBanner({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div
      className={`mb-4 rounded-lg px-4 py-2 text-sm ${
        ok
          ? "border border-emerald-800 bg-emerald-900/40 text-emerald-300"
          : "border border-red-800 bg-red-900/40 text-red-300"
      }`}
    >
      {msg}
    </div>
  );
}
