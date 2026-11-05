"use client";

// D27: last resort when the root layout itself fails. Same rule as error.tsx.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#020617", color: "#f1f5f9" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, textAlign: "center" }}>
          <div>
            <h1>Algo salió mal</h1>
            <p>No pudimos completar la solicitud. Intenta de nuevo en un momento.</p>
            {error.digest && <p style={{ fontSize: 12, opacity: 0.7 }}>Código: {error.digest}</p>}
            <button type="button" onClick={reset}>
              Reintentar
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
