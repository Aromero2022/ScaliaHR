import { requireAuth } from "@/lib/supabase/claims";
import { getModuleFlags } from "@/lib/tenant/get-module-flags";
import { isModuleRouteBlocked } from "@/lib/tenant/module-guards";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function LmsPage() {
  const claims = await requireAuth();

  if (!claims.tenantId) {
    redirect("/dashboard");
  }

  const flags = await getModuleFlags(claims.tenantId);
  if (isModuleRouteBlocked("/lms", flags)) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">
          Formación (LMS)
        </h1>
        <p className="mt-1 text-slate-400">
          Plataforma de aprendizaje integrada con Moodle
        </p>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
        <h2 className="text-lg font-semibold text-white">
          Acceder a la plataforma
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Se abrirá Moodle en una nueva ventana con tu sesión activa.
          Tus cursos y avances están asociados a tu organización.
        </p>
        <Link
          href="/lms/launch"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
            />
          </svg>
          Abrir Moodle
        </Link>
      </div>
    </div>
  );
}
