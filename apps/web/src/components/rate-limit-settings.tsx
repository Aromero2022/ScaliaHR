"use client";

import { useState } from "react";
import { updateTenantRateLimit } from "@/app/(protected)/admin-center/actions";

export interface RateLimitSetting {
  action: "write" | "api";
  label: string;
  maxTokens: number;
  windowSeconds: number;
  isDefault: boolean;
}

/** D28: write and API limits of the tenant; login and MFA limits are fixed by the platform. */
export default function RateLimitSettings({ settings }: { settings: RateLimitSetting[] }) {
  return (
    <div className="space-y-3">
      {settings.map((s) => (
        <RateLimitRow key={s.action} setting={s} />
      ))}
      <p className="text-xs text-slate-500">
        Los límites de inicio de sesión, MFA y alta de empresa los fija la plataforma.
      </p>
    </div>
  );
}

function RateLimitRow({ setting }: { setting: RateLimitSetting }) {
  const [maxTokens, setMaxTokens] = useState(String(setting.maxTokens));
  const [windowSeconds, setWindowSeconds] = useState(String(setting.windowSeconds));
  const [status, setStatus] = useState<{ error?: string; saved?: boolean }>({});
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await updateTenantRateLimit({ action: setting.action, maxTokens, windowSeconds }).catch(() => ({
      error: "No se pudo guardar el límite.",
    }));
    setStatus(result.error ? { error: result.error } : { saved: true });
    setSaving(false);
  }

  const input =
    "w-20 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white focus:border-indigo-500 focus:outline-none";

  return (
    <form onSubmit={save} className="rounded-lg bg-slate-800/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
        <span className="mr-auto font-medium">
          {setting.label}
          {setting.isDefault && <span className="ml-2 text-xs text-slate-500">(predeterminado)</span>}
        </span>
        <label className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            max={600}
            required
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            className={input}
            aria-label={`${setting.label}: solicitudes`}
          />
          solicitudes cada
        </label>
        <label className="flex items-center gap-1">
          <input
            type="number"
            min={10}
            max={3600}
            required
            value={windowSeconds}
            onChange={(e) => setWindowSeconds(e.target.value)}
            className={input}
            aria-label={`${setting.label}: segundos`}
          />
          s
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </div>
      {status.error && <p className="mt-2 text-xs text-red-300">{status.error}</p>}
      {status.saved && <p className="mt-2 text-xs text-emerald-400">Guardado.</p>}
    </form>
  );
}
