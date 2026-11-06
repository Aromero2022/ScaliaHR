"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rememberCompanyCode, signIn } from "./actions";
import { messages } from "@/lib/i18n/es-MX";

const t = messages.login;

export default function LoginForm({ showCompanyCode, demoHint = null }: { showCompanyCode: boolean; demoHint?: string | null }) {
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (showCompanyCode) {
      const saved = await rememberCompanyCode(companyCode);
      if (saved.error) {
        setError(saved.error);
        setLoading(false);
        return;
      }
    }

    const result = await signIn({ email, password }).catch(() => ({ error: t.genericError }));

    if (result.error) {
      setError(result.error);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-fg">
            {messages.app.name}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            {messages.app.tagline}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-line bg-surface p-8 shadow-xl"
        >
          <h2 className="mb-6 text-lg font-semibold text-fg">
            {t.heading}
          </h2>

          {error && (
            <div className="mb-4 rounded-lg border border-danger-line bg-danger-subtle px-4 py-3 text-sm text-danger-fg">
              {error}
            </div>
          )}

          {showCompanyCode && (
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-medium text-fg-muted">
                {t.companyCode}
              </span>
              <input
                type="text"
                autoComplete="organization"
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value)}
                className="w-full rounded-lg border border-control bg-surface-raised px-4 py-2.5 text-fg placeholder:text-fg-subtle focus:border-focus focus:ring-1 focus:ring-focus focus:outline-none"
                placeholder={t.companyCodePlaceholder}
              />
            </label>
          )}

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-fg-muted">
              {t.email}
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-control bg-surface-raised px-4 py-2.5 text-fg placeholder:text-fg-subtle focus:border-focus focus:ring-1 focus:ring-focus focus:outline-none"
              placeholder={t.emailPlaceholder}
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-1 block text-sm font-medium text-fg-muted">
              {t.password}
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-control bg-surface-raised px-4 py-2.5 text-fg placeholder:text-fg-subtle focus:border-focus focus:ring-1 focus:ring-focus focus:outline-none"
              placeholder={t.passwordPlaceholder}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-2.5 font-semibold text-on-accent transition hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? t.submitting : t.submit}
          </button>

          {/* D41: only on a local stack, from the server variable SCALIA_DEMO_LOGIN_HINT. */}
          {demoHint && (
            <p data-demo-login-hint="" className="mt-4 text-center text-xs text-fg-subtle">
              {t.demoHint(demoHint)}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
