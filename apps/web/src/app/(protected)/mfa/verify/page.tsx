"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/auth/mfa-policy";
import { verifyMfa } from "../actions";

export default function MfaVerifyPage() {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    async function loadFactor() {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error || !data.totp.length) {
        const next = searchParams.get("next");
        router.push(next ? `/mfa/enroll?next=${encodeURIComponent(next)}` : "/mfa/enroll");
        return;
      }
      setFactorId(data.totp[0].id);
    }
    loadFactor();
  }, [supabase.auth.mfa, router, searchParams]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);

    const result = await verifyMfa({ factorId, code }).catch(() => ({
      error: "No se pudo completar la verificación. Intenta de nuevo.",
    }));
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(safeNextPath(searchParams.get("next")));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <h1 className="text-2xl font-bold text-fg">Verificar identidad</h1>
      <p className="text-sm text-fg-muted">
        Ingresa el código de 6 dígitos de tu aplicación de autenticación.
      </p>

      <form onSubmit={handleVerify} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-danger-line bg-danger-subtle px-4 py-3 text-sm text-danger-fg">
            {error}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg-muted">
            Código TOTP
          </span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="w-full rounded-lg border border-control bg-surface-raised px-4 py-2.5 text-fg placeholder:text-fg-subtle focus:border-focus focus:ring-1 focus:ring-focus focus:outline-none"
            placeholder="000000"
            autoComplete="one-time-code"
          />
        </label>

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full rounded-lg bg-accent px-4 py-2.5 font-semibold text-on-accent transition hover:bg-accent-hover disabled:opacity-50"
        >
          {loading ? "Verificando..." : "Continuar"}
        </button>
      </form>
    </div>
  );
}
