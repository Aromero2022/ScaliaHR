# Scalia HR — Inventario de Plataforma (Octubre 2026)

> Inventario completo por modulo: tablas, politicas RLS, rutas, Server Actions,
> flags de modulo, permisos RBP, y cobertura de tests.

---

## 1. Employee Central (EC)

### Tablas y RLS

| Tabla | RLS | Politicas | Notas |
|-------|-----|-----------|-------|
| `users` | ENABLE+FORCE | SELECT/INSERT/UPDATE tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | FKs compuestos a department, job_info, position |
| `departments` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | Jerarquia via `parent_id` |
| `legal_entities` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | |
| `business_units` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | FK compuesto a legal_entity |
| `locations` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | |
| `job_families` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | |
| `job_roles` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | FK compuesto a job_family |
| `job_classifications` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | FK compuesto a job_role |
| `positions` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | FKs a department, classification, parent_position |
| `ec_job_information` | ENABLE+FORCE | SELECT/INSERT/UPDATE tenant isolation; RESTRICTIVE `no_hard_delete_authenticated`; RESTRICTIVE admin-only INSERT/UPDATE (`is_tenant_admin()`) | Effective-dated con EXCLUDE btree_gist |
| `ec_compensation` | ENABLE+FORCE | SELECT (own+manager+admin), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | Effective-dated; PII policy RESTRICTIVE |
| `ec_personal_information` | ENABLE+FORCE | SELECT (own+manager+admin), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | Effective-dated; PII policy RESTRICTIVE |
| `object_definitions` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | Metadata de objetos |
| `business_rules` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | Reglas de negocio |

### Rutas

| Ruta | Proteccion auth | `can()` | Module flag |
|------|----------------|---------|-------------|
| `/employees` | `requireAuth()` | `ec.view_org_chart:view` + per-row "Ver perfil" filtering | `is_ec_active` |
| `/employees/[id]` | `requireAuth()` | `ec.view_own_profile:view` (self) / `ec.view_team_profiles:view` (direct reports) / `ec.manage_employees:view` (admin) | `is_ec_active` |

### Server Actions (`employees/[id]/actions.ts`)

| Action | `can()` | Notas |
|--------|---------|-------|
| `createJobChange` | `ec.manage_employees:edit` | Con targetUserId |
| `createCompensationChange` | `ec.manage_employees:edit` | Con targetUserId |
| `createPersonalInfoChange` | `ec.manage_employees:edit` | Con targetUserId |

### Permisos RBP (seeded)

| permission_key | Uso en codigo |
|----------------|---------------|
| `ec.manage_employees` | `can()` en employees/[id], actions, dashboard (KPIs) |
| `ec.manage_org_structure` | Seeded, sin uso directo en `can()` |
| `ec.manage_positions` | Seeded, sin uso directo en `can()` |
| `ec.view_org_chart` | `can()` en employees/page, org-chart/page, sidebar |
| `ec.view_own_profile` | `can()` en employees/[id] (self) |
| `ec.view_team_profiles` | `can()` en employees/[id] (direct reports) |

### Tests

| Test | Tipo | Archivo |
|------|------|---------|
| EC effective dating | Unit | `__tests__/ec-effective-dating.test.ts` |
| Audit + effective records | Integration | `__tests__/integration/audit-and-effective-records.test.ts` |
| Authz matrix (EC perms) | Integration | `__tests__/integration/authz-matrix.test.ts` |
| RESTRICTIVE RLS ec_job_info | Integration | `__tests__/integration/insert-effective-record-rls.test.ts` |
| createTenant() parity | Integration | `__tests__/integration/create-tenant.test.ts` |

---

## 2. Org Chart

### Tablas y RLS

No tiene tablas propias. Consume `departments` (jerarquia `parent_id`), `positions` (`parent_position_id`) y `ec_job_information` (`manager_id`).

### Rutas

| Ruta | Proteccion auth | `can()` | Module flag |
|------|----------------|---------|-------------|
| `/org-chart` | `requireAuth()` | `ec.view_org_chart:view` | `is_ec_active` |

### Tests

Sin tests dedicados (cubierto por authz-matrix.test.ts).

---

## 3. RBP / Admin Center

### Tablas y RLS

| Tabla | RLS | Politicas | Notas |
|-------|-----|-----------|-------|
| `permission_groups` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | |
| `permission_roles` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | |
| `role_permissions` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | Columns: `permission_key`, `field_key`, `action` (v2) |
| `group_members` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | FKs compuestos a group y user |
| `role_grants` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | FKs a role y granted_group |
| `audit_logs` | ENABLE+FORCE | SELECT (admin-only); INSERT revocado a authenticated (via `write_audit_log()` SECURITY DEFINER); RESTRICTIVE `no_update`/`no_delete` | Inmutable una vez escrito |
| `system_configurations` | ENABLE+FORCE | SELECT (admin-only), INSERT/UPDATE (admin-only); RESTRICTIVE `no_hard_delete_authenticated` | |

### Rutas

| Ruta | Proteccion auth | `can()` | Module flag |
|------|----------------|---------|-------------|
| `/admin-center` | `requireAuth()` | `admin.manage_config:edit`, `admin.view_audit_logs:view`, `admin.manage_roles:edit` | Ninguno |
| `/admin-center/manage-roles` | `requireAuth()` | `admin.manage_roles:edit` | Ninguno |

Layout de admin-center verifica `admin_center.access:view`.

### Permisos RBP (seeded)

| permission_key | Uso en codigo |
|----------------|---------------|
| `admin_center.access` | `can()` en layout + sidebar |
| `admin.manage_config` | `can()` en admin-center/page |
| `admin.manage_roles` | `can()` en admin-center/page + manage-roles/page |
| `admin.view_audit_logs` | `can()` en admin-center/page |
| `admin.manage_billing` | Seeded, sin uso en codigo |
| `admin.manage_tenant` | Seeded, sin uso en codigo |

### Tests

| Test | Tipo | Archivo |
|------|------|---------|
| Admin Center authz | Integration | `__tests__/integration/admin-center-authz.test.ts` |
| can() function | Unit | `__tests__/authz/can.test.ts` |
| can RBP chain | Integration | `__tests__/integration/can-rbp-chain.test.ts` |
| can real function | Integration | `__tests__/integration/can-real-function.test.ts` |
| can() coverage (static) | Static | `__tests__/authz/can-coverage.test.ts` |
| authz coverage (static) | Static | `__tests__/static/authz-coverage.test.ts` |
| Authz matrix (full) | Integration | `__tests__/integration/authz-matrix.test.ts` |
| RLS isolation | Integration | `__tests__/integration/rls-isolation.test.ts` |
| Tenants policies | Integration | `__tests__/integration/tenants-policies.test.ts` |
| Module flags | Unit + Integration | `__tests__/tenant-module-flags.test.ts`, `__tests__/integration/module-flags.test.ts` |

---

## 4. PMGM (Performance Management & Goal Management)

### Tablas y RLS

| Tabla | RLS | Politicas | Notas |
|-------|-----|-----------|-------|
| `performance_goals` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `goals_user_visibility` (own+admin), `goals_user_insert` (own), `goals_user_update` (own+admin); `no_hard_delete_authenticated` | FK compuesto a user |
| `continuous_feedbacks` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `feedback_participant_visibility` (author+subject+admin), `feedback_author_insert` (own), `feedback_author_update` (own+admin); `no_hard_delete_authenticated` | FKs a author y subject |

### Rutas

| Ruta | Proteccion auth | `can()` | Module flag |
|------|----------------|---------|-------------|
| `/performance` | `requireAuth()` | `pmgm.view_own_goals:view` | `is_pmgm_active` |

### Server Actions (`performance/actions.ts`)

| Action | `can()` | Notas |
|--------|---------|-------|
| `createGoal` | `pmgm.view_own_goals:edit` | Solo propio (own-only) |
| `sendFeedback` | `pmgm.give_feedback:edit` | |

### Permisos RBP (seeded)

| permission_key | Uso en codigo |
|----------------|---------------|
| `pmgm.give_feedback` | `can()` en performance/actions (sendFeedback) |
| `pmgm.manage_goal_plans` | Seeded, sin uso directo en `can()` |
| `pmgm.manage_team_goals` | Seeded, sin uso directo en `can()` |
| `pmgm.view_own_goals` | `can()` en performance/page + actions (createGoal) + sidebar |
| `pmgm.view_team_feedback` | Seeded, sin uso directo en `can()` |

### Tests

| Test | Tipo | Archivo |
|------|------|---------|
| Authz matrix (PMGM perms) | Integration | `__tests__/integration/authz-matrix.test.ts` |

---

## 5. TIH (Talent Intelligence Hub)

### Tablas y RLS

| Tabla | RLS | Politicas | Notas |
|-------|-----|-----------|-------|
| `skill_ontology` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); `no_hard_delete_authenticated` | CHECK en status y category |
| `job_role_skills` | ENABLE+FORCE | SELECT (all tenant), INSERT/UPDATE (admin-only); `no_hard_delete_authenticated` | PK compuesto (tenant, job_role, skill) |
| `employee_skills` | ENABLE+FORCE | SELECT (own+admin+manager), INSERT (own, sin campos manager), UPDATE (own, column-level GRANT restringe manager_assessed_*); `no_hard_delete_authenticated` | PK compuesto (tenant, user, skill); funciones SECURITY DEFINER para manager assessment |

### Rutas

| Ruta | Proteccion auth | `can()` | Module flag |
|------|----------------|---------|-------------|
| `/skills-hub` | `requireAuth()` | `tih.employee_skills:view` | `is_tih_active` |

### Server Actions (`skills-hub/actions.ts`)

| Action | `can()` | Notas |
|--------|---------|-------|
| `updateSelfAssessment` | `tih.employee_skills:edit` | |
| `setManagerAssessment` | `tih.manager_assessment:edit` | Con targetUserId |
| `createSkill` | `tih.ontology:edit` | |
| `updateSkill` | `tih.ontology:edit` | |
| `updateJobRoleSkill` | `tih.job_requirements:edit` | |

### Permisos RBP

| permission_key | Uso en codigo | Seeded |
|----------------|---------------|--------|
| `tih.employee_skills` | `can()` en page + actions + sidebar | Si (seed.sql, v2 format) |
| `tih.ontology` | `can()` en actions | Si (seed.sql, v2 format) |
| `tih.job_requirements` | `can()` en actions | Si (seed.sql, v2 format) |
| `tih.manager_assessment` | `can()` en skills-hub/actions (setManagerAssessment) | Si |
| `tih.self_assessment` | No se usa en codigo | Si |

> **Nota (v1 legacy):** Las migraciones `20261023070000_tih_skills_hardening.sql` y
> `20261023090000_rbp_tih_seeds.sql` contienen permisos TIH en formato v1
> (`tih.employee_skills.view`, `tih.ontology.view`, `tih.job_requirements.view` — tres
> segmentos con la accion incrustada en la clave). El codigo actual usa formato v2
> (`tih.employee_skills` + columna `action = 'view'`). Los registros v1 quedan como
> datos inertes en `role_permissions`; `seed.sql` y `createTenant()` usan solo v2.

### Tests

| Test | Tipo | Archivo |
|------|------|---------|
| TIH skills hub | Unit | `__tests__/tih-skills-hub.test.ts` |
| TIH RLS integration | Integration | `__tests__/integration/tih-rls-integration.test.ts` |

---

## 6. LMS (Learning Management System)

### Tablas y RLS

| Tabla | RLS | Politicas | Notas |
|-------|-----|-----------|-------|
| `lms_tenant_map` | ENABLE+FORCE | SELECT/INSERT/UPDATE (tenant isolation via `requesting_tenant_id()`); sin DELETE | Mapeo tenant Scalia ↔ Moodle |
| `lms_user_map` | ENABLE+FORCE | SELECT/INSERT/UPDATE (tenant isolation via `requesting_tenant_id()`); sin DELETE | Mapeo usuario Scalia ↔ Moodle |

### Rutas

| Ruta | Proteccion auth | `can()` | Module flag |
|------|----------------|---------|-------------|
| `/lms` | `requireAuth()` | `lms.access:view` | `is_lms_active` |

### Permisos RBP

| permission_key | Uso en codigo | Seeded |
|----------------|---------------|--------|
| `lms.access` | `can()` en lms/page + sidebar | Si (seed.sql, Employee role) |

### Tests

| Test | Tipo | Archivo |
|------|------|---------|
| LMS integration (Moodle) | Unit | `__tests__/lms-integration.test.ts` |
| LMS launch route | Unit | `__tests__/lms-launch-route.test.ts` |

---

## 7. ARCO (Acceso, Rectificacion, Cancelacion, Oposicion)

### Tablas y RLS

| Tabla | RLS | Politicas | Notas |
|-------|-----|-----------|-------|
| `arco_requests` | ENABLE+FORCE | SELECT (own como subject + admin), INSERT (admin-only), UPDATE (admin-only); sin DELETE | Funciones: `anonymize_user()`, `export_user_data()`, `scrub_personal_data()` |

### Rutas

| Ruta | Proteccion auth | `can()` | Module flag |
|------|----------------|---------|-------------|
| `/admin/arco` | `requireAuth()` | `arco.manage:view` | Ninguno |

### Server Actions (`admin/arco/actions.ts`)

| Action | `can()` | Notas |
|--------|---------|-------|
| `createArcoRequest` | `arco.manage:view` | |
| `processArcoRequest` | `arco.manage:view` | |
| `exportUserData` | `arco.manage:view` | |

### Permisos RBP

| permission_key | Uso en codigo | Seeded |
|----------------|---------------|--------|
| `arco.manage` | `can()` en page + actions + sidebar | Si |
| `arco.anonymize` | No se usa en codigo | Si |

### Tests

| Test | Tipo | Archivo |
|------|------|---------|
| AI anonymizer | Unit | `__tests__/ai-anonymizer.test.ts` |
| ARCO field permissions | Unit | `__tests__/arco-field-permissions.test.ts` |
| ARCO actions authz | Unit | `__tests__/arco-actions-authz.test.ts` |
| ARCO anonymization | Unit | `__tests__/arco-anonymization.test.ts` |
| Anonymize user (DB) | Integration | `__tests__/integration/anonymize-user.test.ts` |

---

## 8. SDM (Succession & Development Management)

### Tablas y RLS

| Tabla | RLS | Politicas | Notas |
|-------|-----|-----------|-------|
| `talent_pools` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | |
| `talent_pool_entries` | ENABLE+FORCE | Tenant isolation via parent join (EXISTS on talent_pools); RESTRICTIVE `no_hard_delete_authenticated` | |
| `succession_plans` | ENABLE+FORCE | CRUD tenant isolation; RESTRICTIVE `no_hard_delete_authenticated` | |
| `succession_nominees` | ENABLE+FORCE | Tenant isolation via parent join (EXISTS on succession_plans); RESTRICTIVE `no_hard_delete_authenticated` | |

### Rutas

Sin rutas implementadas aun (tablas existen pero no hay UI).

### Permisos RBP

| permission_key | Uso en codigo | Seeded |
|----------------|---------------|--------|
| `sdm.manage_succession` | No se usa en `can()` aun | Si |
| `sdm.nominate_successors` | No se usa en `can()` aun | Si |

### Tests

Sin tests dedicados.

---

## 9. Plataforma / Core

### Tablas y RLS

| Tabla | RLS | Politicas | Notas |
|-------|-----|-----------|-------|
| `tenants` | ENABLE+FORCE | SELECT (own tenant), UPDATE (owner-only via `has_app_role('owner')`); sin INSERT/DELETE para authenticated | Module flags como columnas booleanas |
| `user_tenant_memberships` | ENABLE+FORCE | SELECT (own rows via `auth.uid()`); sin INSERT/UPDATE/DELETE para authenticated | CHECK: app_role IN (owner, hr_admin, manager, employee) |
| `user_settings` | ENABLE+FORCE | SELECT/INSERT/UPDATE (own, con validacion de membership activa) | active_tenant_id |
| `rate_limits` | Sin politicas user-facing | Solo service_role | Funciones SECURITY DEFINER |

### Rutas

| Ruta | Proteccion auth | `can()` | Module flag |
|------|----------------|---------|-------------|
| `/` | Publica | N/A | N/A |
| `/login` | Publica | N/A | N/A |
| `/dashboard` | `requireAuth()` | `ec.manage_employees:view` (KPIs opcionales) | Ninguno |
| `/profile` | `requireAuth()` | **NINGUNA** | Ninguno |
| `/mfa/enroll` | `requireAuth()` | N/A (flujo auth) | N/A |
| `/mfa/verify` | `requireAuth()` | N/A (flujo auth) | N/A |

### Auth Hooks y Funciones SECURITY DEFINER

| Funcion | Acceso | Proposito |
|---------|--------|-----------|
| `custom_access_token_hook(jsonb)` | `supabase_auth_admin` only | Inyecta tenant_id + app_role en JWT |
| `requesting_tenant_id()` | authenticated, prisma_app | Lee tenant_id del JWT |
| `is_tenant_admin()` | authenticated, prisma_app | Verifica admin via role_grants v2 |
| `current_app_user_id()` | authenticated | Mapea auth.uid() a users.id dentro del tenant |
| `has_app_role(text)` | authenticated | Verifica app_role claim en JWT |
| `write_audit_log(...)` | authenticated, service_role | Fuerza tenant/user de sesion |
| `insert_effective_record(...)` | authenticated | Hardened: tabla cerrada, format(%I), tenant forzado |
| `check_rate_limit(...)` | service_role | Rate limiting |
| `rls_auto_enable()` | service_role | Event trigger auto-enable RLS en tablas nuevas |

### Module Flags

| Flag | Modulo | Usado en route guard |
|------|--------|---------------------|
| `is_ec_active` | Employee Central | Si (`/employees`, `/employees/[id]`, `/org-chart`) |
| `is_pmgm_active` | Performance & Goals | Si (`/performance`) |
| `is_sdm_active` | Succession & Development | **NO** |
| `is_rcm_active` | Recruiting | **NO** |
| `is_lms_active` | Learning Management | Si (`/lms`) |
| `is_onb_active` | Onboarding | **NO** |
| `is_comp_active` | Compensation | **NO** |
| `is_wfa_active` | Workforce Analytics | **NO** |
| `is_wfp_active` | Workforce Planning | **NO** |
| `is_tme_active` | Time Management | **NO** |
| `is_tih_active` | Talent Intelligence Hub | Si (`/skills-hub`) |
| `is_pos_mgmt_active` | Position Management | **NO** |

### Tests Core

| Test | Tipo | Archivo |
|------|------|---------|
| JWT claims | Unit | `__tests__/auth/claims.test.ts` |
| MFA policy | Unit | `__tests__/auth/mfa-policy.test.ts` |
| MFA enroll | Unit | `__tests__/auth/mfa-enroll.test.ts` |
| Middleware | Unit | `__tests__/auth/middleware.test.ts` |
| Middleware location | Unit | `__tests__/middleware-location.test.ts` |
| Forbidden name | Unit | `__tests__/forbidden-name.test.ts` |
| Security headers | Unit | `__tests__/headers/security-headers.test.ts` |
| Rate limiting | Unit | `__tests__/rate-limit/check-rate-limit.test.ts` |
| Link owner script | Unit + Integration | `__tests__/scripts/link-owner.test.ts`, `__tests__/integration/link-owner.test.ts` |
| app_role constraint | Integration | `__tests__/integration/app-role-constraint.test.ts` |
| DB advisors | Integration | `__tests__/integration/db-advisors.test.ts` |
| MFA flow | Integration | `__tests__/integration/mfa-flow.test.ts` |
| S1 security hardening | Integration | `__tests__/integration/s1-security-hardening.test.ts` |
| Seed demo membership | Integration | `__tests__/integration/seed-demo-membership.test.ts` |
| Onboarding E2E | E2E | `__tests__/e2e/onboarding.spec.ts` |

---

## 10. Hallazgos Transversales

### Tablas Legacy / Sin Uso

| Tabla | Estado | Razon |
|-------|--------|-------|
| `job_informations` | LEGACY — no se usa en codigo | Reemplazada por `ec_job_information` (effective-dated). La tabla existe con RLS e indices activos pero ningun archivo en `apps/web/src/` la referencia. |
| `role_assignments` | DROPPED | Eliminada en `s1_deprecate_rbp_v1.sql`. Migrada a `role_grants` + `group_members` (RBP v2). |

### Rutas Sin Proteccion de Permisos RBP

> **Actualizacion (FASE B, 2026-10-31):** Las rutas previamente listadas aqui
> ahora tienen guardias `can()` + module flags. Ver secciones de cada modulo.

Las siguientes rutas estan dentro de `(protected)` pero no verifican `can()`:

| Ruta | Riesgo |
|------|--------|
| `/profile` | Sin restriccion (self-service, aceptado) |
| `/mfa/enroll` | Sin restriccion (flujo auth, aceptado) |
| `/mfa/verify` | Sin restriccion (flujo auth, aceptado) |

### Server Actions Sin `can()`

> **Actualizacion (FASE B, 2026-10-31):** Todos los Server Actions previamente
> listados ahora incluyen guardias `can()`. Ver secciones EC, PMGM, TIH.

No quedan Server Actions sin `can()` en rutas protegidas (excepto las de
allowlist: profile, MFA).

### Permisos Seeded Pero Sin Uso Directo en Codigo

> **Actualizacion (FASE B, 2026-10-31):** La mayoria de permisos EC/PMGM/TIH
> ahora se verifican con `can()`. Los que quedan sin uso directo son:

| permission_key | Modulo | Nota |
|----------------|--------|------|
| `ec.manage_org_structure` | EC | Seeded, sin ruta que lo consuma |
| `ec.manage_positions` | EC | Seeded, sin ruta que lo consuma |
| `pmgm.manage_goal_plans` | PMGM | Seeded, sin UI de admin goals |
| `pmgm.manage_team_goals` | PMGM | Seeded, sin UI de team goals |
| `pmgm.view_team_feedback` | PMGM | Seeded, sin UI de team feedback |
| `sdm.manage_succession` | SDM | Seeded, sin rutas SDM |
| `sdm.nominate_successors` | SDM | Seeded, sin rutas SDM |
| `admin.manage_billing` | Admin | Seeded, sin UI billing |
| `admin.manage_tenant` | Admin | Seeded, sin UI tenant config |
| `arco.anonymize` | ARCO | Seeded, sin uso en `can()` |
| `tih.self_assessment` | TIH | Seeded, sin uso en `can()` |

### Permisos v1 Legacy en Migraciones (Inertes)

Las siguientes claves existen en `role_permissions` como datos insertados por
migraciones v1 (`20261023070000_tih_skills_hardening.sql` y
`20261023090000_rbp_tih_seeds.sql`). Usan el formato de 3 segmentos
(`module.resource.action`) que el codigo ya no consume — `can()` busca
`permission_key` de 2 segmentos (`module.resource`) + columna `action`:

| permission_key (v1) | Equivalente v2 |
|---------------------|----------------|
| `tih.employee_skills.view` | `tih.employee_skills` + action `view` |
| `tih.ontology.view` | `tih.ontology` + action `view` |
| `tih.job_requirements.view` | `tih.job_requirements` + action `view` |

Estos registros no causan conflicto (claves distintas). El seed.sql y
createTenant() solo usan formato v2.

### Datos Demo en Migraciones (deberian estar en seed.sql)

| Migracion | Datos |
|-----------|-------|
| `20261021234500_ec_position_and_foundation.sql` | 4 job families, 9 job roles, 9 classifications, 13 positions |
| `20261022040000_rbp_admin_center.sql` | 3 permission roles, 3 groups, 16 role_permissions, 5 system_configurations |
| `20261023010000_pmgm_user_visibility.sql` | 6 performance goals, 4 continuous feedbacks |
| `20261023020000_tih_talent_intelligence_hub.sql` | 12 skills, job_role_skill mappings, employee_skills |
| `20261023030100_auth_tenant_claims.sql` | user_tenant_memberships para demo auth users |
| `20261023040000_rbp_model_v2.sql` | Owner role, owner permissions, role_grants |
| `20261023050000_ec_foundation.sql` | 1 legal entity, 3 business units, 3 locations |
| `20261023050100_ec_effective_dated.sql` | ec_job_information, ec_compensation, ec_personal_information para 10 empleados |
| `20261023050300_seed_25_employees.sql` | 15 empleados adicionales (e11-e25) con historial completo |
| `20261023070000_tih_skills_hardening.sql` | TIH RBP permission seeds |
| `20261023090000_rbp_tih_seeds.sql` | TIH-specific groups, roles, role_permissions |
| `20261024030000_s1_deprecate_rbp_v1.sql` | Migracion v1 a v2 (convierte role_assignments a role_grants/group_members) |
| `20261028060000_normalize_app_roles.sql` | Fix demo seed membership |
| `20261028070000_admin_center_access_permission.sql` | admin_center.access permission |
| `20261029010000_arco_manage_permission.sql` | arco.manage permission |

### Module Flags Sin Route Guard

> **Actualizacion (FASE B, 2026-10-31):** `is_ec_active` y `is_pmgm_active`
> ahora tienen route guards. Solo quedan flags sin guard para modulos sin UI:

| Flag | Ruta que deberia proteger |
|------|--------------------------|
| `is_pos_mgmt_active` | Rutas de posiciones (cuando existan en UI) |

---

## Resumen

| Metrica | Valor |
|---------|-------|
| Tablas activas | 29 |
| Tablas legacy | 1 (`job_informations`) |
| Tablas con ENABLE+FORCE RLS | 29/29 |
| Tablas con RESTRICTIVE no_hard_delete | 22 |
| Tablas con RESTRICTIVE admin-only INSERT/UPDATE | 3 (`ec_personal_information`, `ec_compensation`, `ec_job_information`) |
| Funciones SECURITY DEFINER | 17 |
| Rutas protegidas | 13 |
| Rutas con `can()` | 10 de 13 (excepto profile, mfa/enroll, mfa/verify) |
| Server Actions | 11 |
| Server Actions con `can()` | 11 de 11 |
| Permission keys seeded (v2) | 28 |
| Permission keys usados en codigo | 17 |
| Module flags definidos | 12 |
| Module flags en route guards | 4 de 12 (ec, pmgm, lms, tih) |
| Tests unitarios | 19 |
| Tests estaticos (can coverage) | 2 |
| Tests de integracion | 17 |
| Tests E2E | 1 |
| Migraciones con datos demo | 15 |
