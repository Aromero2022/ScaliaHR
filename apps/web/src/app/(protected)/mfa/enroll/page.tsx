"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/auth/mfa-policy";
import { logMfaEnroll, logMfaEnrollFailed } from "../actions";
import { mfaErrorMessage } from "@/lib/auth/messages";
import { messages } from "@/lib/i18n/es-MX";

const t = messages.mfaEnroll;

export default function MfaEnrollPage() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    async function enroll() {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      // A verified factor already exists: verify it instead of enrolling another.
      if (factors?.totp.length) {
        const next = searchParams.get("next");
        router.replace(next ? `/mfa/verify?next=${encodeURIComponent(next)}` : "/mfa/verify");
        return;
      }
      // Leftovers from an abandoned enrollment would block a new one.
      for (const factor of factors?.all ?? []) {
        if (factor.factor_type === "totp" && factor.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: t.factorName,
      });
      if (error) {
        setError(mfaErrorMessage(error));
        return;
      }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code.trim());
      setSecret(data.totp.secret);
    }
    enroll();
  }, [supabase.auth.mfa, router, searchParams]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);

    const { data: challenge, error: cErr } =
      await supabase.auth.mfa.challenge({ factorId });
    if (cErr) {
      setError(mfaErrorMessage(cErr));
      setLoading(false);
      return;
    }

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    if (vErr) {
      await logMfaEnrollFailed().catch(() => {});
      setError(mfaErrorMessage(vErr));
      setLoading(false);
      return;
    }

    await logMfaEnroll().catch(() => {});
    router.push(safeNextPath(searchParams.get("next")));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <h1 className="text-2xl font-bold text-fg">
        {t.heading}
      </h1>
      <p className="text-sm text-fg-muted">
        {t.intro}
      </p>

      {qrCode && (
        <div className="flex justify-center rounded-xl border border-line bg-qr-surface p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt={t.qrAlt} width={200} height={200} />
        </div>
      )}

      {secret && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="mb-1 text-xs text-fg-subtle">
            {t.manualEntry}
          </p>
          <code className="select-all text-sm text-accent-fg">{secret}</code>
        </div>
      )}

      <form onSubmit={handleVerify} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-danger-line bg-danger-subtle px-4 py-3 text-sm text-danger-fg">
            {error}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg-muted">
            {t.code}
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
          {loading ? t.submitting : t.submit}
        </button>
      </form>
    </div>
  );
}
