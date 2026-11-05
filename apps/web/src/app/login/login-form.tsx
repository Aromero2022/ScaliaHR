"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rememberCompanyCode, signIn } from "./actions";

export default function LoginForm({ showCompanyCode }: { showCompanyCode: boolean }) {
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

    const result = await signIn({ email, password }).catch(() => ({ error: "No se pudo iniciar sesión. Intenta de nuevo." }));

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
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Scalia HR
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Enterprise Human Capital Management
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl"
        >
          <h2 className="mb-6 text-lg font-semibold text-slate-200">
            Sign in to your account
          </h2>

          {error && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {showCompanyCode && (
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-medium text-slate-300">
                Código de empresa (opcional)
              </span>
              <input
                type="text"
                autoComplete="organization"
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                placeholder="acme-corp"
              />
            </label>
          )}

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-slate-300">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder="you@company.com"
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-1 block text-sm font-medium text-slate-300">
              Password
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder="••••••••"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <p className="mt-4 text-center text-xs text-slate-500">
            Demo: elena.martinez@acme.dev / Demo1234!
          </p>
        </form>
      </div>
    </div>
  );
}
