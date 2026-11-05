"use client";

// D27: what any page shows when it fails. Never the error's message or stack:
// only a generic text and the digest, which the server logs next to the
// request id (instrumentation.ts).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-100">Algo salió mal</h1>
        <p className="mt-2 text-sm text-slate-400">No pudimos completar la solicitud. Intenta de nuevo en un momento.</p>
        {error.digest && <p className="mt-4 text-xs text-slate-500">Código: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Reintentar
        </button>
      </div>
    </main>
  );
}
