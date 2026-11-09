"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { createArcoRequest, processArcoRequest, exportUserData } from "./actions";
import PersonSearch from "@/components/person-search";
import { messages } from "@/lib/i18n/es-MX";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";

// D42: dates and "overdue" arrive from the server, computed in the tenant's time zone; this client component never formats dates.
// D43: stat cards and badges from components/ui; the texts come from the es-MX module.

const t = messages.arco;

type ArcoRow = {
  id: string;
  requestType: string;
  status: string;
  description: string;
  resolutionNotes: string | null;
  exportHash: string | null;
  dueLabel: string;
  completedLabel: string | null;
  createdLabel: string;
  isOverdue: boolean;
  requesterName: string;
  subjectName: string;
  subjectEmail: string;
  subjectId: string;
};

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
        setFeedback({ ok: true, msg: t.created });
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
          action === "reject" ? t.rejectedNote : t.processedNote,
      });
      if (result.success) {
        setFeedback({
          ok: true,
          msg: action === "approve" ? t.processed : t.rejected,
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
          msg: t.exported(result.data.hash.slice(0, 16)),
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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-4">
        <StatCard label={t.stats.total} value={requests.length} />
        <StatCard label={t.stats.pending} value={pending.length} tone="warning" />
        <StatCard label={t.stats.completed} value={resolved.filter((r) => r.status === "completed").length} tone="success" />
        <StatCard label={t.stats.rejected} value={resolved.filter((r) => r.status === "rejected").length} tone="danger" />
      </div>

      {/* Actions bar */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover"
        >
          {t.newRequest}
        </button>
      </div>

      {/* Pending requests */}
      {pending.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-fg">
            {t.pendingHeading}
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
          {t.historyHeading}
        </h2>
        {resolved.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t.noResolved}</p>
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
              {t.newRequest}
            </h2>
            <button
              onClick={() => setShowCreate(false)}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-hover hover:text-fg"
            >
              <span aria-hidden="true">✕</span>
              <span className="sr-only">{messages.common.close}</span>
            </button>
          </div>

          {feedback && (
            <FeedbackBanner ok={feedback.ok} msg={feedback.msg} />
          )}

          <form action={handleCreateSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-subtle">
                {t.form.subject} <span className="text-danger-fg">*</span>
              </span>
              <PersonSearch name="subjectId" label={t.form.subjectSearch} includeSelf showEmail />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-subtle">
                {t.form.type} <span className="text-danger-fg">*</span>
              </span>
              <select
                name="requestType"
                required
                className="w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus"
              >
                <option value="">{t.form.choose}</option>
                {Object.entries(t.form.typeOptions).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-subtle">
                {t.form.description} <span className="text-danger-fg">*</span>
              </span>
              <textarea
                name="description"
                required
                rows={3}
                className="w-full rounded-lg border border-control bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus"
                placeholder={t.form.descriptionPlaceholder}
              />
            </label>

            <button
              type="submit"
              disabled={isPending}
              className="min-h-11 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? t.form.submitting : t.form.submit}
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
                {t.detail.heading}
              </h2>
              <button
                onClick={() => setSelectedRequest(null)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-hover hover:text-fg"
              >
                <span aria-hidden="true">✕</span>
                <span className="sr-only">{messages.common.close}</span>
              </button>
            </div>

            {feedback && (
              <FeedbackBanner ok={feedback.ok} msg={feedback.msg} />
            )}

            <dl className="space-y-3 text-sm">
              <DetailRow label={t.detail.type}>
                <Badge enumName="arco_request_type" value={selectedRequest.requestType} />
              </DetailRow>
              <DetailRow label={t.detail.status}>
                <Badge enumName="arco_request_status" value={selectedRequest.status} />
              </DetailRow>
              <DetailRow label={t.detail.subject}>
                {selectedRequest.subjectName} ({selectedRequest.subjectEmail})
              </DetailRow>
              <DetailRow label={t.detail.requester}>
                {selectedRequest.requesterName}
              </DetailRow>
              <DetailRow label={t.detail.description}>
                {selectedRequest.description}
              </DetailRow>
              <DetailRow label={t.detail.due}>
                {selectedRequest.dueLabel}
              </DetailRow>
              <DetailRow label={t.detail.created}>
                {selectedRequest.createdLabel}
              </DetailRow>
              {selectedRequest.completedLabel && (
                <DetailRow label={t.detail.resolved}>
                  {selectedRequest.completedLabel}
                </DetailRow>
              )}
              {selectedRequest.resolutionNotes && (
                <DetailRow label={t.detail.notes}>
                  {selectedRequest.resolutionNotes}
                </DetailRow>
              )}
              {selectedRequest.exportHash && (
                <DetailRow label={t.detail.exportHash}>
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
                    {isPending ? t.detail.exporting : t.detail.export}
                  </button>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleProcess("approve")}
                    disabled={isPending}
                    className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-on-success transition hover:bg-success-hover disabled:opacity-50"
                  >
                    {isPending ? t.detail.processing : t.detail.approve}
                  </button>
                  <button
                    onClick={() => handleProcess("reject")}
                    disabled={isPending}
                    className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-on-danger transition hover:bg-danger-hover disabled:opacity-50"
                  >
                    {isPending ? t.detail.processing : t.detail.reject}
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

function RequestCard({
  request,
  onClick,
}: {
  request: ArcoRow;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg border border-line p-4 text-left transition hover:border-accent-line hover:bg-surface-hover"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge enumName="arco_request_type" value={request.requestType} />
          <Badge enumName="arco_request_status" value={request.status} />
          {request.isOverdue && (
            <span className="rounded-full bg-danger-subtle px-2 py-0.5 text-xs font-medium text-danger-fg">
              {t.overdue}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-fg">
          {request.subjectName} — {request.description.slice(0, 80)}
          {request.description.length > 80 && "…"}
        </p>
        <p className="mt-0.5 text-xs text-fg-subtle">
          {t.card.requester} {request.requesterName} · {t.card.due} {request.dueLabel}
        </p>
      </div>
      <svg
        aria-hidden="true"
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
