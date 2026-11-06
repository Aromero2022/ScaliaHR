import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { redirect } from "next/navigation";
import { can } from "@/lib/authz/can";
import Link from "next/link";
import { z } from "zod";
import ArcoPanel from "./arco-panel";

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

  const supabase = await createClient();
  const { data: currentUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_uid", claims.userId)
    .single();

  if (!currentUser) redirect("/login");

  const { allowed } = await can(currentUser.id, "arco.manage", "view");
  if (!allowed) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <h1 className="text-xl font-bold text-fg">Acceso denegado</h1>
        <p className="mt-2 text-sm text-fg-muted">
          No tiene permisos para gestionar solicitudes ARCO. Contacte al
          administrador del tenant.
        </p>
      </div>
    );
  }

  const { data: requests, count } = await supabase
    .from("arco_requests")
    .select(
      "*, requester:users!arco_requests_requester_id_fkey(first_name, last_name), subject:users!arco_requests_subject_id_fkey(first_name, last_name, email)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * ARCO_PAGE_SIZE, page * ARCO_PAGE_SIZE - 1);
  const pages = Math.max(1, Math.ceil((count ?? 0) / ARCO_PAGE_SIZE));

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
      dueDate: r.due_date as string,
      completedAt: r.completed_at as string | null,
      createdAt: r.created_at as string,
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
