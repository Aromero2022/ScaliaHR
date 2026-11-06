import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/claims";
import { redirect, notFound } from "next/navigation";
import { can } from "@/lib/authz/can";
import Link from "next/link";
import RateLimitSettings, { type RateLimitSetting } from "@/components/rate-limit-settings";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatInstant } from "@/lib/format/dates";
import { getTenantTimeZone } from "@/lib/tenant/get-tenant-time-zone";
import { messages } from "@/lib/i18n/es-MX";
import { ButtonLink } from "@/components/ui/button";
import { StatCard, type StatTone } from "@/components/ui/stat-card";

// D43: one primary per view; "Gestionar roles" is navigation, so it is secondary
// and the rate limits' "Guardar" is the view's primary. Texts from es-MX.
const t = messages.adminCenter;

interface Stat {
  label: string;
  value: number | string;
  icon: "shield" | "users" | "key" | "person";
  tone: StatTone;
}

interface ConfigRow {
  key: string;
  value_json: unknown;
}

interface AuditRow {
  action: string;
  created_at: string;
  entity: string | null;
  entity_id: string | null;
  diff: Record<string, unknown> | null;
  details_json: Record<string, unknown> | null;
  user: { first_name: string; last_name: string }[] | { first_name: string; last_name: string } | null;
}

export default async function AdminCenterPage() {
  const claims = await requireAuth();
  if (!claims.tenantId) redirect("/login");
  const { timeZone } = await getTenantTimeZone(claims.tenantId);

  const supabase = await createClient();
  const bizUser = await getCurrentUser();
  if (!bizUser) redirect("/login");

  const [configPerm, auditPerm, rolesPerm] = await Promise.all([
    can(bizUser.id, "admin.manage_config", "edit"),
    can(bizUser.id, "admin.view_audit_logs", "view"),
    can(bizUser.id, "admin.manage_roles", "edit"),
  ]);

  if (!configPerm.allowed && !auditPerm.allowed && !rolesPerm.allowed) {
    notFound();
  }

  const [rolesRes, groupsRes, permsRes, configsRes, auditRes, usersRes, limitsRes] =
    await Promise.all([
      supabase
        .from("permission_roles")
        .select("id, name, is_admin_role", { count: "exact", head: true }),
      supabase
        .from("permission_groups")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("role_permissions")
        .select("id", { count: "exact", head: true }),
      configPerm.allowed
        ? supabase
            .from("system_configurations")
            .select("key, value_json")
            .order("key")
        : Promise.resolve({ data: [], error: null }),
      auditPerm.allowed
        ? supabase
            .from("audit_logs")
            .select("action, created_at, entity, entity_id, diff, details_json, user:users(first_name, last_name)")
            .order("created_at", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("users")
        .select("id", { count: "exact", head: true }),
      configPerm.allowed
        ? supabase.from("tenant_rate_limits").select("action, max_tokens, window_seconds")
        : Promise.resolve({ data: [], error: null }),
    ]);

  const stats: Stat[] = [
    { label: t.stats.roles, value: rolesRes.count ?? 0, icon: "shield", tone: "accent" },
    { label: t.stats.groups, value: groupsRes.count ?? 0, icon: "users", tone: "success" },
    { label: t.stats.permissions, value: permsRes.count ?? 0, icon: "key", tone: "warning" },
    { label: t.stats.users, value: usersRes.count ?? 0, icon: "person", tone: "info" },
  ];

  const configs = (configsRes.data ?? []) as ConfigRow[];
  const auditEntries = (auditRes.data ?? []) as AuditRow[];
  const rateLimits: RateLimitSetting[] = (
    [
      ["write", t.rateLimits.write],
      ["api", t.rateLimits.api],
    ] as const
  ).map(([action, label]) => {
    const own = (limitsRes.data ?? []).find((row) => row.action === action);
    return {
      action,
      label,
      maxTokens: own?.max_tokens ?? RATE_LIMITS[action].maxTokens,
      windowSeconds: own?.window_seconds ?? RATE_LIMITS[action].windowSeconds,
      isDefault: !own,
    };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg">{t.heading}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {t.subheading}
          </p>
        </div>
        {rolesPerm.allowed && (
          <ButtonLink href="/admin-center/manage-roles" variant="secondary">
            {t.manageRoles}
          </ButtonLink>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} tone={s.tone} icon={<StatIcon name={s.icon} />} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* System Configuration — requires admin.manage_config:edit */}
        {configPerm.allowed && (
          <div className="rounded-xl border border-line bg-surface p-6">
            <h2 className="mb-4 text-lg font-semibold text-fg">
              {t.configHeading}
            </h2>
            <div className="space-y-3">
              {configs.map((c) => (
                <div
                  key={c.key}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-surface-muted px-4 py-3"
                >
                  <span className="text-sm font-medium text-fg-muted">
                    {c.key}
                  </span>
                  <span className="min-w-0 break-all text-sm text-fg-muted">
                    {typeof c.value_json === "string"
                      ? c.value_json
                      : JSON.stringify(c.value_json)}
                  </span>
                </div>
              ))}
              {configs.length === 0 && (
                <p className="text-sm text-fg-subtle">
                  {t.noConfig}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Rate limits (D28) — requires admin.manage_config:edit */}
        {configPerm.allowed && (
          <div className="rounded-xl border border-line bg-surface p-6">
            <h2 className="mb-4 text-lg font-semibold text-fg">
              {t.rateLimits.heading}
            </h2>
            <RateLimitSettings settings={rateLimits} />
          </div>
        )}

        {/* Recent Audit Log — requires admin.view_audit_logs:view */}
        {auditPerm.allowed && (
          <div className="rounded-xl border border-line bg-surface p-6">
            <h2 className="mb-4 text-lg font-semibold text-fg">
              {t.auditHeading}
            </h2>
            <div className="space-y-3">
              {auditEntries.map((a, i) => {
                const usr = Array.isArray(a.user) ? a.user[0] : a.user;
                return (
                  <div
                    key={i}
                    className="rounded-lg bg-surface-muted px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-block rounded-full bg-accent-subtle px-2.5 py-0.5 text-xs font-medium text-accent-fg">
                        {a.action}
                      </span>
                      <span className="text-xs text-fg-subtle">
                        {formatInstant(a.created_at, timeZone)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-fg-muted">
                      {usr
                        ? `${(usr as Record<string, string>).first_name} ${(usr as Record<string, string>).last_name}`
                        : t.system}
                      {a.entity ? ` — ${a.entity}` : ""}
                      {a.entity_id ? ` (${a.entity_id})` : ""}
                      {a.details_json &&
                      typeof a.details_json === "object" &&
                      "description" in a.details_json
                        ? ` — ${a.details_json.description}`
                        : ""}
                    </p>
                    {a.diff && Object.keys(a.diff).length > 0 && (
                      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-surface px-2 py-1 text-xs text-fg-subtle">
                        {JSON.stringify(a.diff, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
              {auditEntries.length === 0 && (
                <p className="text-sm text-fg-subtle">
                  {t.noAudit}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">
          {t.quickLinks.heading}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {rolesPerm.allowed && (
            <Link
              href="/admin-center/manage-roles"
              className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-muted px-4 py-3 text-sm text-fg-muted transition hover:bg-surface-hover"
            >
              <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-subtle text-accent-fg">
                <ShieldSvg />
              </span>
              {t.quickLinks.roles}
            </Link>
          )}
          <Link
            href="/org-chart"
            className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-muted px-4 py-3 text-sm text-fg-muted transition hover:bg-surface-hover"
          >
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-success-subtle text-success-fg">
              <OrgSvg />
            </span>
            {t.quickLinks.orgChart}
          </Link>
          <Link
            href="/dashboard"
            className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-muted px-4 py-3 text-sm text-fg-muted transition hover:bg-surface-hover"
          >
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-info-subtle text-info-fg">
              <HomeSvg />
            </span>
            {t.quickLinks.dashboard}
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatIcon({ name }: { name: Stat["icon"] }) {
  if (name === "shield") return <ShieldSvg />;
  if (name === "users") return <OrgSvg />;
  if (name === "key") return <KeySvg />;
  return <PersonSvg />;
}

function ShieldSvg() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function KeySvg() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}

function PersonSvg() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function OrgSvg() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  );
}

function HomeSvg() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}
