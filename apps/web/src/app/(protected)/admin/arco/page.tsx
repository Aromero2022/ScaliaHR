import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { redirect } from "next/navigation";
import { can } from "@/lib/authz/can";
import Link from "next/link";
import { z } from "zod";
import ArcoPanel from "./arco-panel";
import { calendarDateIn, formatDateOnly, formatInstant } from "@/lib/format/dates";
import { getTenantTimeZone } from "@/lib/tenant/get-tenant-time-zone";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageLoadError } from "@/components/ui/load-error";
import { safeError } from "@/lib/errors/safe-error";
import { messages } from "@/lib/i18n/es-MX";

// D38: the request list is paged; the subject is searched, not listed.
const ARCO_PAGE_SIZE = 20;
const Params = z.object({ page: z.coerce.number().int().min(1).max(10_000).catch(1) });

export default async function ArcoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { page } = Params.parse(await searchParams);
  const claims = await requireAuth();
  if (!claims.tenantId) redirect("/login");

  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const { allowed } = await can(currentUser.id, "arco.manage", "view");
  if (!allowed) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <h1 className="text-xl font-bold text-fg">Acceso denegado</h1>
        <p className="mt-2 text-sm text-fg-muted">
          No tienes permisos para gestionar solicitudes ARCO. Contacta al
          administrador del tenant.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: requests, count, error } = await supabase
    .from("arco_requests")
    .select(
      "*, requester:users!arco_requests_requester_id_fkey(first_name, last_name), subject:users!arco_requests_subject_id_fkey(first_name, last_name, email)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * ARCO_PAGE_SIZE, page * ARCO_PAGE_SIZE - 1);
  // D45: the request list is the page; if it cannot be read, nothing else is shown.
  if (error) {
    return <PageLoadError title="Derechos ARCO" message={await safeError("arco.requests", error, messages.common.pageLoadError)} />;
  }
  const pages = Math.max(1, Math.ceil((count ?? 0) / ARCO_PAGE_SIZE));

  // D42: due_date is a calendar date; created_at and completed_at are moments in the tenant's zone.
  // A request is overdue once its due date has passed in that zone.
  const { timeZone } = await getTenantTimeZone(claims.tenantId);
  const today = calendarDateIn(timeZone);
  const rows = (requests ?? []).map((r) => {
    const req = r.requester as { first_name: string; last_name: string } | null;
    const sub = r.subject as {
      first_name: string;
      last_name: string;
      email: string;
    } | null;
    return {
      id: r.id as string,
      requestType: r.request_type as string,
      status: r.status as string,
      description: r.description as string,
      resolutionNotes: r.resolution_notes as string | null,
      exportHash: r.export_hash as string | null,
      dueLabel: formatDateOnly(r.due_date as string),
      completedLabel: r.completed_at ? formatInstant(r.completed_at as string, timeZone, { withTime: false }) : null,
      createdLabel: formatInstant(r.created_at as string, timeZone, { withTime: false }),
      isOverdue: (r.status === "pending" || r.status === "in_progress") && (r.due_date as string) < today,
      requesterName: req ? `${req.first_name} ${req.last_name}` : "—",
      subjectName: sub ? `${sub.first_name} ${sub.last_name}` : "—",
      subjectEmail: sub?.email ?? "—",
      subjectId: r.subject_id as string,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Derechos ARCO</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Gestión de solicitudes de Acceso, Rectificación, Cancelación y
          Oposición — Protección de datos personales
        </p>
      </div>
      <ArcoPanel requests={rows} />
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-fg-muted">
          {page > 1 ? <Link href={`/admin/arco?page=${page - 1}`} className="hover:text-fg">← Anteriores</Link> : <span />}
          <span>
            {page} / {pages}
          </span>
          {page < pages ? <Link href={`/admin/arco?page=${page + 1}`} className="hover:text-fg">Siguientes →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
