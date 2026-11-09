"use client";

import { useState } from "react";
import { enumLabel, messages } from "@/lib/i18n/es-MX";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InputField, TextareaField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { LoadError } from "@/components/ui/load-error";

// D43: the create-role form is a Dialog (native <dialog>); its success message is a toast.

const t = messages.roles;

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
  /** D45: the request id message of a list that could not be read; that list shows it instead of rows. */
  rolesError?: string | null;
  groupsError?: string | null;
}

export default function RoleManager({ roles, groups, rolesError = null, groupsError = null }: Props) {
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="space-y-6">
      {/* Roles Table */}
      <div className="rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold text-fg">
            {t.rolesHeading(rolesError ? null : roles.length)}
          </h2>
          <Button onClick={() => setShowCreateModal(true)}>{t.newRole}</Button>
        </div>

        {rolesError ? (
          <div className="p-4 md:p-6">
            <LoadError message={rolesError} />
          </div>
        ) : (
          <div className="divide-y divide-line">
            {roles.map((role) => {
              const isExpanded = expandedRole === role.id;
              return (
                <div key={role.id}>
                  <button
                    onClick={() =>
                      setExpandedRole(isExpanded ? null : role.id)
                    }
                    aria-expanded={isExpanded}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 text-left transition hover:bg-surface-hover md:px-6"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-raised">
                      {role.is_admin_role ? (
                        <svg
                          aria-hidden="true"
                          className="h-5 w-5 text-warning-fg"
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
                          aria-hidden="true"
                          className="h-5 w-5 text-fg-muted"
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

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">
                          {role.name}
                        </span>
                        {role.is_admin_role && (
                          <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-medium text-warning-fg">
                            {t.adminBadge}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-fg-muted">
                        {role.description ?? t.noDescription}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-subtle">
                      <span>{t.permissionsCount(role.permissions.length)}</span>
                      <span>{t.grantsCount(role.grants.length)}</span>
                      <svg
                        aria-hidden="true"
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
                    <div className="border-t border-line bg-canvas px-6 py-4">
                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        {/* Permissions */}
                        <div>
                          <h3 className="mb-3 text-sm font-semibold text-fg-muted">
                            {t.technicalPermissions}
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {role.permissions.map((p) => (
                              <span
                                key={`${p.permission_key}:${p.action}`}
                                className="rounded-lg bg-surface-raised px-3 py-1.5 text-xs font-mono text-fg-muted"
                              >
                                {p.permission_key}:{p.action}
                              </span>
                            ))}
                            {role.permissions.length === 0 && (
                              <span className="text-sm text-fg-subtle">
                                {t.noPermissions}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Grants (v2) */}
                        <div>
                          <h3 className="mb-3 text-sm font-semibold text-fg-muted">
                            {t.grants}
                          </h3>
                          <div className="space-y-2">
                            {role.grants.map((g) => (
                              <div
                                key={g.id}
                                className="rounded-lg bg-surface-raised px-3 py-2"
                              >
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="text-success-fg">
                                    {t.grantedGroup}
                                  </span>
                                  <span className="font-medium text-fg">
                                    {g.granted_group?.name ?? messages.common.empty}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center gap-2 text-xs">
                                  <span className="text-info-fg">
                                    {t.targetPopulation}
                                  </span>
                                  <span className="font-medium text-fg">
                                    {enumLabel("target_population_type", g.target_population)}
                                  </span>
                                </div>
                              </div>
                            ))}
                            {role.grants.length === 0 && (
                              <span className="text-sm text-fg-subtle">
                                {t.noGrants}
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
                <p className="text-sm text-fg-subtle">
                  {t.noRoles}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Permission Groups Table */}
      <div className="rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold text-fg">
            {t.groupsHeading(groupsError ? null : groups.length)}
          </h2>
        </div>
        {groupsError ? (
          <div className="p-4 md:p-6">
            <LoadError message={groupsError} />
          </div>
        ) : (
          <div className="divide-y divide-line">
            {groups.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 md:px-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success-subtle">
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5 text-success-fg"
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
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">{g.name}</p>
                  <p className="text-sm text-fg-muted">
                    {g.description ?? t.noDescription}
                  </p>
                </div>
                <div className="rounded-lg bg-surface-raised px-3 py-1.5 text-xs font-mono text-fg-muted">
                  {t.membership}
                </div>
              </div>
            ))}
            {groups.length === 0 && (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-fg-subtle">
                  {t.noGroups}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <CreateRoleDialog open={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </div>
  );
}

function CreateRoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = t.createDialog;
  const toast = useToast();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    onClose();
    toast.success(d.created(String(form.get("name") ?? ""), form.get("is_admin") === "on"));
  }

  return (
    <Dialog open={open} onClose={onClose} title={d.title}>
      <p className="mb-5 text-sm text-fg-muted">{d.simulation}</p>
      <form onSubmit={handleSubmit} className="space-y-5">
        <InputField label={d.name} name="name" required placeholder={d.namePlaceholder} />
        <TextareaField label={d.description} name="description" rows={2} placeholder={d.descriptionPlaceholder} />
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            name="is_admin"
            className="h-4 w-4 rounded-sm border-control bg-surface-raised text-accent-fg focus:ring-focus"
          />
          <span className="text-sm text-fg-muted">{d.adminRole}</span>
        </label>
        <div className="flex flex-wrap gap-3 pt-1">
          <Button type="submit" className="flex-1">
            {d.submit}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {messages.common.cancel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
