"use client";

import { useState } from "react";

interface Permission {
  permission_key: string;
  action: string;
}

interface Grant {
  id: string;
  granted_group: { name: string } | null;
  target_population: string;
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_admin_role: boolean;
  permissions: Permission[];
  grants: Grant[];
}

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
}

interface Props {
  roles: RoleRow[];
  groups: GroupRow[];
}

export default function RoleManager({ roles, groups }: Props) {
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="space-y-6">
      {/* Roles Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">
            Roles de Permiso ({roles.length})
          </h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            + Nuevo Rol
          </button>
        </div>

        <div className="divide-y divide-slate-800">
          {roles.map((role) => {
            const isExpanded = expandedRole === role.id;
            return (
              <div key={role.id}>
                <button
                  onClick={() =>
                    setExpandedRole(isExpanded ? null : role.id)
                  }
                  className="flex w-full items-center gap-4 px-6 py-4 text-left transition hover:bg-slate-800/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800">
                    {role.is_admin_role ? (
                      <svg
                        className="h-5 w-5 text-amber-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="h-5 w-5 text-slate-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                        />
                      </svg>
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">
                        {role.name}
                      </span>
                      {role.is_admin_role && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                          ADMIN
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-400">
                      {role.description ?? "Sin descripción"}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-slate-500">
                    <span>{role.permissions.length} permisos</span>
                    <span>{role.grants.length} asignaciones</span>
                    <svg
                      className={`h-4 w-4 transition ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                      />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-800/50 bg-slate-950/30 px-6 py-4">
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                      {/* Permissions */}
                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-slate-300">
                          Permisos Técnicos
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {role.permissions.map((p) => (
                            <span
                              key={`${p.permission_key}:${p.action}`}
                              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-mono text-slate-300"
                            >
                              {p.permission_key}:{p.action}
                            </span>
                          ))}
                          {role.permissions.length === 0 && (
                            <span className="text-sm text-slate-500">
                              Sin permisos asignados
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Grants (v2) */}
                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-slate-300">
                          Asignaciones (Role Grants)
                        </h3>
                        <div className="space-y-2">
                          {role.grants.map((g) => (
                            <div
                              key={g.id}
                              className="rounded-lg bg-slate-800 px-3 py-2"
                            >
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-emerald-400">
                                  Grupo otorgado:
                                </span>
                                <span className="font-medium text-slate-200">
                                  {g.granted_group?.name ?? "—"}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-xs">
                                <span className="text-sky-400">
                                  Población objetivo:
                                </span>
                                <span className="font-medium text-slate-200">
                                  {g.target_population}
                                </span>
                              </div>
                            </div>
                          ))}
                          {role.grants.length === 0 && (
                            <span className="text-sm text-slate-500">
                              Sin asignaciones
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {roles.length === 0 && (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-slate-500">
                No hay roles de permiso configurados.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Permission Groups Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">
            Grupos de Permiso ({groups.length})
          </h2>
        </div>
        <div className="divide-y divide-slate-800">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-4 px-6 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/20">
                <svg
                  className="h-5 w-5 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium text-white">{g.name}</p>
                <p className="text-sm text-slate-400">
                  {g.description ?? "Sin descripción"}
                </p>
              </div>
              <div className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-mono text-slate-400">
                membresía vía group_members
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-slate-500">
                No hay grupos de permiso configurados.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create Role Modal (simulation) */}
      {showCreateModal && (
        <CreateRoleModal onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}

function CreateRoleModal({ onClose }: { onClose: () => void }) {
  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white">Crear Nuevo Rol</h3>
        <p className="mt-1 text-sm text-slate-400">
          Simulación — los datos no se persisten en esta versión MVP
        </p>

        {submitted ? (
          <div className="mt-6 rounded-lg bg-emerald-500/10 p-4 text-center">
            <p className="text-sm font-medium text-emerald-400">
              Rol &quot;{roleName}&quot; creado (simulación)
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {isAdmin ? "Admin" : "Estándar"} — {roleDesc || "Sin descripción"}
            </p>
            <button
              onClick={onClose}
              className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-700"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Nombre del Rol
              </label>
              <input
                type="text"
                required
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="Ej. Recruitment Manager"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Descripción
              </label>
              <textarea
                value={roleDesc}
                onChange={(e) => setRoleDesc(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="Descripción del rol..."
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
              />
              <span className="text-sm text-slate-300">
                Rol de Administrador
              </span>
            </label>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
              >
                Crear Rol
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-700"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
