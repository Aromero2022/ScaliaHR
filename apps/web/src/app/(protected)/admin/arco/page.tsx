import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can } from "@/lib/authz/can";
import ArcoPanel from "./arco-panel";

export default async function ArcoPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const { data: currentUser } = await supabase
    .from("users")
    .select("id, tenant_id")
    .eq("auth_uid", authUser.id)
    .single();

  if (!currentUser) redirect("/login");

  const { allowed } = await can(currentUser.id, "arco.manage", "view");
  if (!allowed) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <h1 className="text-xl font-bold text-white">Acceso denegado</h1>
        <p className="mt-2 text-sm text-slate-400">
          No tiene permisos para gestionar solicitudes ARCO. Contacte al
          administrador del tenant.
        </p>
      </div>
    );
  }

  const { data: requests } = await supabase
    .from("arco_requests")
    .select(
      "*, requester:users!arco_requests_requester_id_fkey(first_name, last_name), subject:users!arco_requests_subject_id_fkey(first_name, last_name, email)"
    )
    .order("created_at", { ascending: false });

  const { data: employees } = await supabase
    .from("users")
    .select("id, first_name, last_name, email")
    .eq("status", "ACTIVE")
    .is("deleted_at", null)
    .order("last_name");

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

  const employeeOptions = (employees ?? []).map((e) => ({
    id: e.id as string,
    label: `${e.first_name} ${e.last_name} (${e.email})`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Derechos ARCO</h1>
        <p className="mt-1 text-sm text-slate-400">
          Gestión de solicitudes de Acceso, Rectificación, Cancelación y
          Oposición — Protección de datos personales
        </p>
      </div>
      <ArcoPanel requests={rows} employees={employeeOptions} />
    </div>
  );
}
