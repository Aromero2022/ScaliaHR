"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/auth/mfa-policy";

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

    const { data: challenge, error: cErr } =
      await supabase.auth.mfa.challenge({ factorId });
    if (cErr) {
      setError(cErr.message);
      setLoading(false);
      return;
    }

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    if (vErr) {
      setError(vErr.message);
      setLoading(false);
      return;
    }

    router.push(safeNextPath(searchParams.get("next")));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <h1 className="text-2xl font-bold text-white">Verificar identidad</h1>
      <p className="text-sm text-slate-400">
        Ingresa el código de 6 dígitos de tu aplicación de autenticación.
      </p>

      <form onSubmit={handleVerify} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-300">
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
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            placeholder="000000"
            autoComplete="one-time-code"
          />
        </label>

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? "Verificando..." : "Continuar"}
        </button>
      </form>
    </div>
  );
}
