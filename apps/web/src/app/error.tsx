"use client";

// D27: what any page shows when it fails. Never the error's message or stack:
// only a generic text and the digest, which the server logs next to the
// request id (instrumentation.ts).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold text-fg">Algo salió mal</h1>
        <p className="mt-2 text-sm text-fg-muted">No pudimos completar la solicitud. Intenta de nuevo en un momento.</p>
        {error.digest && <p className="mt-4 text-xs text-fg-subtle">Código: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          Reintentar
        </button>
      </div>
    </main>
  );
}
