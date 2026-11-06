"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rememberCompanyCode, signIn } from "./actions";
import { messages } from "@/lib/i18n/es-MX";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";

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
    <main className="flex min-h-screen items-center justify-center px-4">
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

          <div className="space-y-5">
            {showCompanyCode && (
              <InputField
                label={t.companyCode}
                type="text"
                autoComplete="organization"
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value)}
                placeholder={t.companyCodePlaceholder}
              />
            )}
            <InputField
              label={t.email}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailPlaceholder}
            />
            <InputField
              label={t.password}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordPlaceholder}
            />
            <Button type="submit" loading={loading} className="w-full">
              {loading ? t.submitting : t.submit}
            </Button>
          </div>

          {/* D41: only on a local stack, from the server variable SCALIA_DEMO_LOGIN_HINT. */}
          {demoHint && (
            <p data-demo-login-hint="" className="mt-4 text-center text-xs text-fg-subtle">
              {t.demoHint(demoHint)}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
