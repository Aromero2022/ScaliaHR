import Link from "next/link";

export default function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-subtle">
        <svg
          className="h-8 w-8 text-danger-fg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-fg">Acceso denegado</h1>
      <p className="text-sm text-fg-muted">
        No tienes permisos para acceder a esta sección.
      </p>
      <Link
        href="/dashboard"
        className="mt-2 rounded-lg border border-line px-4 py-2 text-sm text-fg-muted transition hover:border-accent hover:text-fg"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
