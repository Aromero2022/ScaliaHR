"use client";

import { DEFAULT_THEME_ATTRIBUTES, DEFAULT_THEME_CSS } from "@/lib/theme";
import "./globals.css";

// D27: last resort when the root layout itself fails. Same rule as error.tsx.
// It renders its own <html>, so it brings the theme tokens with it (D40).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es" {...DEFAULT_THEME_ATTRIBUTES}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: DEFAULT_THEME_CSS }} />
      </head>
      <body className="bg-canvas font-sans text-fg antialiased">
        <main className="grid min-h-screen place-items-center p-4 text-center">
          <div>
            <h1 className="text-lg font-semibold">Algo salió mal</h1>
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
      </body>
    </html>
  );
}
