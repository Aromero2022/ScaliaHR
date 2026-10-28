-- ═══════════════════════════════════════════════════════════════════════
-- Demo data: tenant acme-corp (a0000000-0000-0000-0000-000000000001)
--
-- Contents: tenant + foundation objects (legal entity, business units,
-- locations, departments, job families/roles/classifications, positions),
-- 25 employees with current ec_job_information (manager hierarchy),
-- ec_compensation and ec_personal_information, RBP v2 (roles, permissions,
-- groups, members, grants), system configuration, and TIH demo data
-- (skill ontology, job role requirements, employee skill assessments).
--
-- Idempotent: fixed or md5-derived ids and ON CONFLICT DO NOTHING
-- everywhere (the tenant's module flags are re-applied), so running it again
-- changes nothing.
-- Creates no auth users and no passwords; users.auth_uid stays NULL. If the
-- auth user f0000000-…0001 (Elena) already exists, it gets her membership.
--
-- Loaded by: `supabase db reset` (config.toml [db.seed]),
-- db-remote-sync with load_seed=true (rehearsal + remote), and the
-- db-reset-test CI job. Integration tests must not depend on this data.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Tenant ──────────────────────────────────────────────────────────────
-- Module flags (tenants.is_*_active, the single source of truth) are
-- re-applied on every run, so a tenant created earlier ends up with the demo
-- modules on. LMS stays off: it needs a Moodle instance (MOODLE_* variables).
INSERT INTO public.tenants (id, name, slug, domain,
  is_ec_active, is_pmgm_active, is_sdm_active, is_tih_active, is_pos_mgmt_active,
  is_rcm_active, is_lms_active, is_onb_active, is_comp_active, is_wfa_active,
  is_wfp_active, is_tme_active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'Acme Corp', 'acme-corp', 'acme.dev',
  true, true, true, true, true,
  false, false, false, false, false,
  false, false)
ON CONFLICT (id) DO UPDATE SET
  is_ec_active       = EXCLUDED.is_ec_active,
  is_pmgm_active     = EXCLUDED.is_pmgm_active,
  is_sdm_active      = EXCLUDED.is_sdm_active,
  is_tih_active      = EXCLUDED.is_tih_active,
  is_pos_mgmt_active = EXCLUDED.is_pos_mgmt_active,
  is_rcm_active      = EXCLUDED.is_rcm_active,
  is_lms_active      = EXCLUDED.is_lms_active,
  is_onb_active      = EXCLUDED.is_onb_active,
  is_comp_active     = EXCLUDED.is_comp_active,
  is_wfa_active      = EXCLUDED.is_wfa_active,
  is_wfp_active      = EXCLUDED.is_wfp_active,
  is_tme_active      = EXCLUDED.is_tme_active;

-- ── Foundation objects ──────────────────────────────────────────────────
INSERT INTO public.legal_entities (id, tenant_id, code, name, country, rfc)
VALUES ('ae100000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'LE-ACME-MX', 'Acme Corp México S.A. de C.V.', 'MX', 'ACM010101AAA')
ON CONFLICT DO NOTHING;

INSERT INTO public.business_units (id, tenant_id, code, name, legal_entity_id) VALUES
  ('be100000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'BU-TECH',  'Technology Division', 'ae100000-0000-0000-0000-000000000001'),
  ('be100000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'BU-SALES', 'Sales Division',      'ae100000-0000-0000-0000-000000000001'),
  ('be100000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'BU-HR',    'Human Resources',     'ae100000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO public.locations (id, tenant_id, code, name, city, state, country, timezone) VALUES
  ('ce100000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'LOC-CDMX-HQ', 'CDMX Headquarters',  'Ciudad de México', 'CDMX',       'MX', 'America/Mexico_City'),
  ('ce100000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'LOC-GDL',     'Guadalajara Office', 'Guadalajara',      'Jalisco',    'MX', 'America/Mexico_City'),
  ('ce100000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'LOC-MTY',     'Monterrey Office',   'Monterrey',        'Nuevo León', 'MX', 'America/Monterrey')
ON CONFLICT DO NOTHING;

INSERT INTO public.departments (id, tenant_id, name, code, parent_id, legal_entity_id, business_unit_id, location_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Executive',       'EXEC',  NULL,                                   'ae100000-0000-0000-0000-000000000001', NULL,                                   'ce100000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Engineering',     'ENG',   'd0000000-0000-0000-0000-000000000001', 'ae100000-0000-0000-0000-000000000001', 'be100000-0000-0000-0000-000000000001', 'ce100000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Sales',           'SALES', 'd0000000-0000-0000-0000-000000000001', 'ae100000-0000-0000-0000-000000000001', 'be100000-0000-0000-0000-000000000002', 'ce100000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Human Resources', 'HR',    'd0000000-0000-0000-0000-000000000001', 'ae100000-0000-0000-0000-000000000001', 'be100000-0000-0000-0000-000000000003', 'ce100000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Frontend',        'FE',    'd0000000-0000-0000-0000-000000000002', 'ae100000-0000-0000-0000-000000000001', 'be100000-0000-0000-0000-000000000001', 'ce100000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Backend',         'BE',    'd0000000-0000-0000-0000-000000000002', 'ae100000-0000-0000-0000-000000000001', 'be100000-0000-0000-0000-000000000001', 'ce100000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO public.job_families (id, tenant_id, family_code, name) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'EXEC',  'Executive Leadership'),
  ('f1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'ENG',   'Engineering'),
  ('f1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'SALES', 'Sales & Marketing'),
  ('f1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'HR',    'Human Resources')
ON CONFLICT DO NOTHING;

INSERT INTO public.job_roles (id, tenant_id, role_code, name, job_family_id) VALUES
  ('aa100000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'CEO',       'Chief Executive Officer',  'f1000000-0000-0000-0000-000000000001'),
  ('aa100000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'CTO',       'Chief Technology Officer', 'f1000000-0000-0000-0000-000000000001'),
  ('aa100000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'VP_SALES',  'VP of Sales',              'f1000000-0000-0000-0000-000000000001'),
  ('aa100000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'HR_DIR',    'HR Director',              'f1000000-0000-0000-0000-000000000004'),
  ('aa100000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'LEAD_FE',   'Frontend Lead',            'f1000000-0000-0000-0000-000000000002'),
  ('aa100000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'LEAD_BE',   'Backend Lead',             'f1000000-0000-0000-0000-000000000002'),
  ('aa100000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'SWE',       'Software Engineer',        'f1000000-0000-0000-0000-000000000002'),
  ('aa100000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'SALES_MGR', 'Sales Manager',            'f1000000-0000-0000-0000-000000000003'),
  ('aa100000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'HR_SPEC',   'HR Specialist',            'f1000000-0000-0000-0000-000000000004')
ON CONFLICT DO NOTHING;

INSERT INTO public.job_classifications (id, tenant_id, job_code, title, pay_grade, job_role_id) VALUES
  ('cc100000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'CEO-L1',       'CEO',               'EX-1', 'aa100000-0000-0000-0000-000000000001'),
  ('cc100000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'CTO-L1',       'CTO',               'EX-2', 'aa100000-0000-0000-0000-000000000002'),
  ('cc100000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'VP-SALES-L1',  'VP of Sales',       'EX-2', 'aa100000-0000-0000-0000-000000000003'),
  ('cc100000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'HR-DIR-L1',    'HR Director',       'M-1',  'aa100000-0000-0000-0000-000000000004'),
  ('cc100000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'FE-LEAD-L1',   'Frontend Lead',     'M-2',  'aa100000-0000-0000-0000-000000000005'),
  ('cc100000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'BE-LEAD-L1',   'Backend Lead',      'M-2',  'aa100000-0000-0000-0000-000000000006'),
  ('cc100000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'SWE-L1',       'Software Engineer', 'IC-3', 'aa100000-0000-0000-0000-000000000007'),
  ('cc100000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'SALES-MGR-L1', 'Sales Manager',     'M-2',  'aa100000-0000-0000-0000-000000000008'),
  ('cc100000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'HR-SPEC-L1',   'HR Specialist',     'IC-2', 'aa100000-0000-0000-0000-000000000009')
ON CONFLICT DO NOTHING;

INSERT INTO public.positions (id, tenant_id, position_code, title, fte, is_vacant, department_id, job_classification_id, parent_position_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'POS-001', 'CEO',                      1.0, false, 'd0000000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', NULL),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'POS-002', 'CTO',                      1.0, false, 'd0000000-0000-0000-0000-000000000002', 'cc100000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'POS-003', 'VP of Sales',              1.0, false, 'd0000000-0000-0000-0000-000000000003', 'cc100000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'POS-004', 'HR Director',              1.0, false, 'd0000000-0000-0000-0000-000000000004', 'cc100000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'POS-005', 'Frontend Lead',            1.0, false, 'd0000000-0000-0000-0000-000000000005', 'cc100000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'POS-006', 'Backend Lead',             1.0, false, 'd0000000-0000-0000-0000-000000000006', 'cc100000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'POS-007', 'Sales Manager',            1.0, true,  'd0000000-0000-0000-0000-000000000003', 'cc100000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000003'),
  ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'POS-008', 'HR Specialist',            1.0, false, 'd0000000-0000-0000-0000-000000000004', 'cc100000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000004'),
  ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'POS-009', 'Frontend Engineer',        1.0, false, 'd0000000-0000-0000-0000-000000000005', 'cc100000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000005'),
  ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'POS-010', 'Backend Engineer',         1.0, false, 'd0000000-0000-0000-0000-000000000006', 'cc100000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000006'),
  ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'POS-011', 'Sales Executive',          1.0, false, 'd0000000-0000-0000-0000-000000000003', 'cc100000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000003'),
  ('b0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'POS-012', 'Senior Frontend Engineer', 1.0, false, 'd0000000-0000-0000-0000-000000000005', 'cc100000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000005'),
  ('b0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'POS-013', 'DevOps Engineer',          1.0, false, 'd0000000-0000-0000-0000-000000000006', 'cc100000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000006')
ON CONFLICT DO NOTHING;

-- ── Employees (e01–e25) ─────────────────────────────────────────────────
-- Ids: e0000000-0000-0000-0000-0000000000NN. Departments d…0N, positions b…0N.
INSERT INTO public.users (id, tenant_id, auth_uid, email, first_name, last_name,
                          employee_id, hire_date, status, department_id, position_id)
SELECT ('e0000000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid,
       'a0000000-0000-0000-0000-000000000001',
       NULL,
       v.email, v.first_name, v.last_name,
       'EMP-' || lpad(v.n::text, 3, '0'),
       v.hire_date::timestamptz,
       'ACTIVE'::public."EmployeeStatus",
       ('d0000000-0000-0000-0000-' || lpad(v.dept::text, 12, '0'))::uuid,
       ('b0000000-0000-0000-0000-' || lpad(v.pos::text, 12, '0'))::uuid
FROM (VALUES
  ( 1, 'elena.martinez@acme.dev',    'Elena',     'Martínez',  '2020-01-15', 1,  1),
  ( 2, 'carlos.ruiz@acme.dev',       'Carlos',    'Ruiz',      '2020-03-01', 2,  2),
  ( 3, 'maria.lopez@acme.dev',       'María',     'López',     '2021-01-10', 3,  3),
  ( 4, 'ana.torres@acme.dev',        'Ana',       'Torres',    '2022-07-01', 4,  4),
  ( 5, 'pedro.sanchez@acme.dev',     'Pedro',     'Sánchez',   '2020-06-15', 5,  5),
  ( 6, 'laura.diaz@acme.dev',        'Laura',     'Díaz',      '2020-08-01', 6,  6),
  ( 7, 'roberto.garcia@acme.dev',    'Roberto',   'García',    '2021-04-01', 5,  9),
  ( 8, 'sofia.mendez@acme.dev',      'Sofía',     'Méndez',    '2021-09-15', 6, 10),
  ( 9, 'diego.herrera@acme.dev',     'Diego',     'Herrera',   '2022-02-01', 3, 11),
  (10, 'lucia.flores@acme.dev',      'Lucía',     'Flores',    '2022-05-01', 4,  8),
  (11, 'gabriela.morales@acme.dev',  'Gabriela',  'Morales',   '2023-06-01', 5, 12),
  (12, 'fernando.ruiz@acme.dev',     'Fernando',  'Ruiz',      '2024-01-15', 5,  9),
  (13, 'patricia.castro@acme.dev',   'Patricia',  'Castro',    '2023-09-01', 5,  9),
  (14, 'ricardo.flores@acme.dev',    'Ricardo',   'Flores',    '2023-03-01', 6, 10),
  (15, 'isabel.torres@acme.dev',     'Isabel',    'Torres',    '2023-07-01', 6, 10),
  (16, 'miguel.vargas@acme.dev',     'Miguel',    'Vargas',    '2024-02-01', 6, 13),
  (17, 'carmen.reyes@acme.dev',      'Carmen',    'Reyes',     '2023-04-01', 3, 11),
  (18, 'alejandro.mendez@acme.dev',  'Alejandro', 'Méndez',    '2024-03-01', 3, 11),
  (19, 'natalia.jimenez@acme.dev',   'Natalia',   'Jiménez',   '2023-11-01', 3, 11),
  (20, 'daniel.herrera@acme.dev',    'Daniel',    'Herrera',   '2023-08-01', 4,  8),
  (21, 'andrea.silva@acme.dev',      'Andrea',    'Silva',     '2023-02-01', 4,  8),
  (22, 'jose.ramirez@acme.dev',      'José',      'Ramírez',   '2024-05-01', 4,  8),
  (23, 'valeria.gutierrez@acme.dev', 'Valeria',   'Gutiérrez', '2023-01-15', 1, NULL),
  (24, 'luis.ortiz@acme.dev',        'Luis',      'Ortiz',     '2024-01-01', 1, NULL),
  (25, 'monica.salazar@acme.dev',    'Mónica',    'Salazar',   '2023-05-01', 2, NULL)
) AS v(n, email, first_name, last_name, hire_date, dept, pos)
ON CONFLICT DO NOTHING;

-- ── ec_job_information ──────────────────────────────────────────────────
-- Current rows: e1000000-0000-0000-0000-0000000000NN (end_date NULL).
-- History rows: e1000000-0000-0000-0001-0000000000NN.
INSERT INTO public.ec_job_information (id, tenant_id, user_id, start_date, end_date, sequence,
  position_id, department_id, location_id, job_classification_id, job_title, manager_id, event_reason)
SELECT ('e1000000-0000-0000-' || v.kind || '-' || lpad(v.n::text, 12, '0'))::uuid,
       'a0000000-0000-0000-0000-000000000001',
       ('e0000000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid,
       v.start_date::date, v.end_date::date, v.seq,
       ('b0000000-0000-0000-0000-' || lpad(v.pos::text, 12, '0'))::uuid,
       ('d0000000-0000-0000-0000-' || lpad(v.dept::text, 12, '0'))::uuid,
       ('ce100000-0000-0000-0000-' || lpad(v.loc::text, 12, '0'))::uuid,
       ('cc100000-0000-0000-0000-' || lpad(v.cls::text, 12, '0'))::uuid,
       v.title,
       ('e0000000-0000-0000-0000-' || lpad(v.mgr::text, 12, '0'))::uuid,
       v.reason
FROM (VALUES
  ('0001',  1, '2020-01-15', '2022-06-01', 1,    4, 4, 1,    4, 'HR Director',            NULL, 'Hire'),
  ('0000',  1, '2022-06-01', NULL,         2,    1, 1, 1,    1, 'CEO',                    NULL, 'Promotion'),
  ('0000',  2, '2020-03-01', NULL,         1,    2, 2, 1,    2, 'CTO',                       1, 'Hire'),
  ('0000',  3, '2021-01-10', NULL,         1,    3, 3, 2,    3, 'VP of Sales',               1, 'Hire'),
  ('0000',  4, '2022-07-01', NULL,         1,    4, 4, 1,    4, 'HR Director',               1, 'Hire'),
  ('0001',  5, '2020-06-15', '2023-01-01', 1,    9, 5, 1,    7, 'Frontend Engineer',         2, 'Hire'),
  ('0000',  5, '2023-01-01', NULL,         2,    5, 5, 1,    5, 'Frontend Lead',             2, 'Promotion'),
  ('0000',  6, '2020-08-01', NULL,         1,    6, 6, 2,    6, 'Backend Lead',              2, 'Hire'),
  ('0000',  7, '2021-04-01', NULL,         1,    9, 5, 1,    7, 'Frontend Engineer',         5, 'Hire'),
  ('0000',  8, '2021-09-15', NULL,         1,   10, 6, 2,    7, 'Backend Engineer',          6, 'Hire'),
  ('0000',  9, '2022-02-01', NULL,         1,   11, 3, 2,    8, 'Sales Executive',           3, 'Hire'),
  ('0000', 10, '2022-05-01', NULL,         1,    8, 4, 1,    9, 'HR Specialist',             4, 'Hire'),
  ('0001', 11, '2023-06-01', '2024-06-01', 1,   12, 5, 1,    7, 'Jr. Frontend Developer',    5, 'Contratación'),
  ('0000', 11, '2024-06-01', NULL,         2,   12, 5, 1,    7, 'Frontend Developer',        5, 'Promoción'),
  ('0000', 12, '2024-01-15', NULL,         1,    9, 5, 2,    7, 'Frontend Developer',        5, 'Contratación'),
  ('0000', 13, '2023-09-01', NULL,         1,    9, 5, 1,    7, 'QA Engineer',               5, 'Contratación'),
  ('0000', 14, '2023-03-01', NULL,         1,   10, 6, 1,    7, 'Backend Developer',         6, 'Contratación'),
  ('0001', 15, '2023-07-01', '2024-04-01', 1,   10, 6, 1,    7, 'Backend Developer',         6, 'Contratación'),
  ('0000', 15, '2024-04-01', NULL,         2,   10, 6, 2,    7, 'Backend Developer',         6, 'Transferencia a GDL'),
  ('0000', 16, '2024-02-01', NULL,         1,   13, 6, 3,    7, 'DevOps Engineer',           6, 'Contratación'),
  ('0000', 17, '2023-04-01', NULL,         1,   11, 3, 1,    8, 'Sales Executive',           3, 'Contratación'),
  ('0000', 18, '2024-03-01', NULL,         1,   11, 3, 2,    8, 'Sales Executive',           3, 'Contratación'),
  ('0000', 19, '2023-11-01', NULL,         1,   11, 3, 1,    8, 'Sales Coordinator',         3, 'Contratación'),
  ('0000', 20, '2023-08-01', NULL,         1,    8, 4, 1,    9, 'HR Analyst',                4, 'Contratación'),
  ('0001', 21, '2023-02-01', '2024-02-01', 1,    8, 4, 1,    9, 'HR Assistant',              4, 'Contratación'),
  ('0000', 21, '2024-02-01', NULL,         2,    8, 4, 1,    9, 'HR Coordinator',            4, 'Promoción'),
  ('0000', 22, '2024-05-01', NULL,         1,    8, 4, 1,    9, 'Payroll Specialist',        4, 'Contratación'),
  ('0000', 23, '2023-01-15', NULL,         1, NULL, 1, 1, NULL, 'Chief of Staff',            1, 'Contratación'),
  ('0000', 24, '2024-01-01', NULL,         1, NULL, 1, 1, NULL, 'Executive Assistant',       1, 'Contratación'),
  ('0000', 25, '2023-05-01', NULL,         1, NULL, 2, 3,    7, 'Tech Lead',                 2, 'Contratación')
) AS v(kind, n, start_date, end_date, seq, pos, dept, loc, cls, title, mgr, reason)
ON CONFLICT DO NOTHING;

-- ── ec_compensation (current rows) ──────────────────────────────────────
-- Ids: ec000000-0000-0000-0000-0000000000NN.
INSERT INTO public.ec_compensation (id, tenant_id, user_id, start_date, end_date, sequence,
  currency, base_salary, frequency, bonus_target, event_reason)
SELECT ('ec000000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid,
       'a0000000-0000-0000-0000-000000000001',
       ('e0000000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid,
       v.start_date::date, NULL, 1,
       'MXN', v.salary, 'monthly'::public.pay_frequency, v.bonus, v.reason
FROM (VALUES
  ( 1, '2024-01-01', 180000.00::numeric, 30.00::numeric, 'Annual Review'),
  ( 2, '2023-01-01', 140000.00, 20.00, 'Annual Review'),
  ( 3, '2021-01-10', 110000.00, 20.00, 'Hire'),
  ( 4, '2022-07-01',  90000.00, 15.00, 'Hire'),
  ( 5, '2023-01-01',  70000.00, 10.00, 'Promotion'),
  ( 6, '2020-08-01',  72000.00, 10.00, 'Hire'),
  ( 7, '2021-04-01',  42000.00,  5.00, 'Hire'),
  ( 8, '2021-09-15',  44000.00,  5.00, 'Hire'),
  ( 9, '2022-02-01',  38000.00, 15.00, 'Hire'),
  (10, '2022-05-01',  35000.00,  5.00, 'Hire'),
  (11, '2024-06-01',  35000.00, NULL,  'Promoción'),
  (12, '2024-01-15',  38000.00, NULL,  'Contratación'),
  (13, '2023-09-01',  32000.00, NULL,  'Contratación'),
  (14, '2023-03-01',  40000.00, NULL,  'Contratación'),
  (15, '2024-04-01',  36000.00, NULL,  'Ajuste por transferencia'),
  (16, '2024-02-01',  45000.00, NULL,  'Contratación'),
  (17, '2023-04-01',  25000.00, 15.00, 'Contratación'),
  (18, '2024-03-01',  22000.00, 15.00, 'Contratación'),
  (19, '2023-11-01',  20000.00, NULL,  'Contratación'),
  (20, '2023-08-01',  28000.00, NULL,  'Contratación'),
  (21, '2024-02-01',  26000.00, NULL,  'Promoción'),
  (22, '2024-05-01',  35000.00, NULL,  'Contratación'),
  (23, '2023-01-15',  70000.00, 20.00, 'Contratación'),
  (24, '2024-01-01',  22000.00, NULL,  'Contratación'),
  (25, '2023-05-01',  65000.00, 15.00, 'Contratación')
) AS v(n, start_date, salary, bonus, reason)
ON CONFLICT DO NOTHING;

-- ── ec_personal_information (current rows) ──────────────────────────────
-- Ids: ed000000-0000-0000-0000-0000000000NN.
INSERT INTO public.ec_personal_information (id, tenant_id, user_id, start_date, end_date, sequence,
  first_name, last_name, date_of_birth, gender, nationality, national_id, phone, country, event_reason)
SELECT ('ed000000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid,
       'a0000000-0000-0000-0000-000000000001',
       ('e0000000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid,
       v.start_date::date, NULL, 1,
       v.first_name, v.last_name, v.dob::date, v.gender, 'Mexicana', v.national_id, v.phone, 'MX', 'Hire'
FROM (VALUES
  ( 1, '2020-01-15', 'Elena',     'Martínez',  '1985-03-12', 'F', 'MARE850312MDFXXX01', '+52 55 1234 0001'),
  ( 2, '2020-03-01', 'Carlos',    'Ruiz',      '1982-07-25', 'M', 'RUIC820725HDFXXX02', '+52 55 1234 0002'),
  ( 3, '2021-01-10', 'María',     'López',     '1988-11-08', 'F', 'LOPM881108MDFXXX03', '+52 33 1234 0003'),
  ( 4, '2022-07-01', 'Ana',       'Torres',    '1990-05-20', 'F', 'TORA900520MDFXXX04', '+52 55 1234 0004'),
  ( 5, '2020-06-15', 'Pedro',     'Sánchez',   '1993-09-15', 'M', 'SANP930915HDFXXX05', '+52 55 1234 0005'),
  ( 6, '2020-08-01', 'Laura',     'Díaz',      '1991-01-30', 'F', 'DIAL910130MDFXXX06', '+52 33 1234 0006'),
  ( 7, '2021-04-01', 'Roberto',   'García',    '1995-06-18', 'M', 'GARR950618HDFXXX07', '+52 55 1234 0007'),
  ( 8, '2021-09-15', 'Sofía',     'Méndez',    '1994-12-03', 'F', 'MENS941203MDFXXX08', '+52 33 1234 0008'),
  ( 9, '2022-02-01', 'Diego',     'Herrera',   '1992-08-22', 'M', 'HERD920822HDFXXX09', '+52 33 1234 0009'),
  (10, '2022-05-01', 'Lucía',     'Flores',    '1996-04-10', 'F', 'FLOL960410MDFXXX10', '+52 55 1234 0010'),
  (11, '2023-06-01', 'Gabriela',  'Morales',   '1995-03-12', 'F', NULL, '+52 55 2211 3344'),
  (12, '2024-01-15', 'Fernando',  'Ruiz',      '1992-08-25', 'M', NULL, '+52 33 4455 6677'),
  (13, '2023-09-01', 'Patricia',  'Castro',    '1990-11-05', 'F', NULL, '+52 55 8899 0011'),
  (14, '2023-03-01', 'Ricardo',   'Flores',    '1988-07-20', 'M', NULL, '+52 55 1122 3344'),
  (15, '2023-07-01', 'Isabel',    'Torres',    '1993-01-15', 'F', NULL, '+52 33 5566 7788'),
  (16, '2024-02-01', 'Miguel',    'Vargas',    '1991-04-30', 'M', NULL, '+52 81 9900 1122'),
  (17, '2023-04-01', 'Carmen',    'Reyes',     '1989-09-18', 'F', NULL, '+52 55 3344 5566'),
  (18, '2024-03-01', 'Alejandro', 'Méndez',    '1994-12-01', 'M', NULL, '+52 33 7788 9900'),
  (19, '2023-11-01', 'Natalia',   'Jiménez',   '1996-06-22', 'F', NULL, '+52 55 1234 0000'),
  (20, '2023-08-01', 'Daniel',    'Herrera',   '1992-02-14', 'M', NULL, '+52 55 5678 0000'),
  (21, '2023-02-01', 'Andrea',    'Silva',     '1997-10-08', 'F', NULL, '+52 55 9012 3456'),
  (22, '2024-05-01', 'José',      'Ramírez',   '1990-05-17', 'M', NULL, '+52 55 3456 7890'),
  (23, '2023-01-15', 'Valeria',   'Gutiérrez', '1987-03-28', 'F', NULL, '+52 55 6789 0123'),
  (24, '2024-01-01', 'Luis',      'Ortiz',     '1998-08-10', 'M', NULL, '+52 55 0123 4567'),
  (25, '2023-05-01', 'Mónica',    'Salazar',   '1991-11-25', 'F', NULL, '+52 81 4567 8901')
) AS v(n, start_date, first_name, last_name, dob, gender, national_id, phone)
ON CONFLICT DO NOTHING;

-- ── RBP v2 ──────────────────────────────────────────────────────────────
INSERT INTO public.permission_roles (id, tenant_id, name, description, is_admin_role) VALUES
  ('bb100000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'HR Administrator',        'Full access to all HR modules and configuration',      true),
  ('bb100000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Employee (Self-Service)', 'View own profile, goals, feedback and skills',          false),
  ('bb100000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Manager',                 'View and manage direct reports',                        false),
  ('bb100000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'Owner',                   'Tenant owner with full control',                        true)
ON CONFLICT DO NOTHING;

INSERT INTO public.permission_groups (id, tenant_id, name, description) VALUES
  ('cc100000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'All Administrators', 'Users with HR admin access'),
  ('cc100000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'All Employees',      'Every active employee in the tenant'),
  ('cc100000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'All Managers',       'Employees with direct reports')
ON CONFLICT DO NOTHING;

-- Ids: md5('acme:rp:' || role || ':' || key || ':' || action).
INSERT INTO public.role_permissions (id, tenant_id, role_id, permission_key, field_key, action)
SELECT md5('acme:rp:' || v.role_id || ':' || v.permission_key || ':' || v.action)::uuid,
       'a0000000-0000-0000-0000-000000000001',
       v.role_id::uuid, v.permission_key, NULL, v.action::public.rbp_action
FROM (
  SELECT r.role_id, p.permission_key, p.action
  FROM (VALUES ('bb100000-0000-0000-0000-000000000001'), ('bb100000-0000-0000-0000-000000000010')) AS r(role_id)
  CROSS JOIN (VALUES
    ('admin.manage_roles', 'edit'), ('admin.manage_config', 'edit'), ('admin.view_audit_logs', 'view'),
    ('ec.manage_employees', 'edit'), ('ec.manage_positions', 'edit'), ('ec.manage_org_structure', 'edit'),
    ('pmgm.manage_goal_plans', 'edit'), ('sdm.manage_succession', 'edit'),
    ('tih.ontology', 'view'), ('tih.ontology', 'edit'),
    ('tih.job_requirements', 'view'), ('tih.job_requirements', 'edit'),
    ('tih.employee_skills', 'view'), ('tih.employee_skills', 'edit')
  ) AS p(permission_key, action)
  UNION ALL
  SELECT 'bb100000-0000-0000-0000-000000000010', p.permission_key, p.action
  FROM (VALUES ('admin.manage_tenant', 'edit'), ('admin.manage_billing', 'edit')) AS p(permission_key, action)
  UNION ALL
  SELECT 'bb100000-0000-0000-0000-000000000002', p.permission_key, p.action
  FROM (VALUES
    ('ec.view_own_profile', 'view'), ('ec.view_org_chart', 'view'),
    ('pmgm.view_own_goals', 'view'), ('pmgm.give_feedback', 'edit'),
    ('tih.ontology', 'view'), ('tih.employee_skills', 'view'), ('tih.employee_skills', 'edit')
  ) AS p(permission_key, action)
  UNION ALL
  SELECT 'bb100000-0000-0000-0000-000000000003', p.permission_key, p.action
  FROM (VALUES
    ('ec.view_team_profiles', 'view'), ('pmgm.manage_team_goals', 'edit'),
    ('pmgm.view_team_feedback', 'view'), ('sdm.nominate_successors', 'edit'),
    ('tih.ontology', 'view'), ('tih.job_requirements', 'view'),
    ('tih.employee_skills', 'view'), ('tih.employee_skills', 'edit')
  ) AS p(permission_key, action)
) AS v
ON CONFLICT DO NOTHING;

-- Ids: md5('acme:rg:' || role || ':' || group || ':' || population).
INSERT INTO public.role_grants (id, tenant_id, role_id, granted_group_id, target_population)
SELECT md5('acme:rg:' || v.role_id || ':' || v.group_id || ':' || v.population)::uuid,
       'a0000000-0000-0000-0000-000000000001',
       v.role_id::uuid, v.group_id::uuid, v.population::public.target_population_type
FROM (VALUES
  ('bb100000-0000-0000-0000-000000000010', 'cc100000-0000-0000-0000-000000000001', 'all'),
  ('bb100000-0000-0000-0000-000000000001', 'cc100000-0000-0000-0000-000000000001', 'all'),
  ('bb100000-0000-0000-0000-000000000003', 'cc100000-0000-0000-0000-000000000003', 'direct_reports'),
  ('bb100000-0000-0000-0000-000000000003', 'cc100000-0000-0000-0000-000000000003', 'same_department'),
  ('bb100000-0000-0000-0000-000000000002', 'cc100000-0000-0000-0000-000000000002', 'self')
) AS v(role_id, group_id, population)
ON CONFLICT DO NOTHING;

-- Ids: md5('acme:gm:' || group || ':' || user).
-- Administrators: Elena (e01, CEO) and Ana (e04, HR Director).
-- All Employees: e01–e25. All Managers: everyone with a current direct report.
INSERT INTO public.group_members (id, tenant_id, group_id, user_id)
SELECT md5('acme:gm:' || m.group_id || ':' || m.user_id)::uuid,
       'a0000000-0000-0000-0000-000000000001',
       m.group_id::uuid, m.user_id::uuid
FROM (
  SELECT 'cc100000-0000-0000-0000-000000000001' AS group_id, u.user_id
  FROM (VALUES ('e0000000-0000-0000-0000-000000000001'), ('e0000000-0000-0000-0000-000000000004')) AS u(user_id)
  UNION ALL
  SELECT 'cc100000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-' || lpad(n::text, 12, '0')
  FROM generate_series(1, 25) AS n
  UNION ALL
  SELECT DISTINCT 'cc100000-0000-0000-0000-000000000003', eji.manager_id::text
  FROM public.ec_job_information eji
  WHERE eji.tenant_id = 'a0000000-0000-0000-0000-000000000001'
    AND eji.end_date IS NULL AND eji.manager_id IS NOT NULL
) AS m
ON CONFLICT DO NOTHING;

INSERT INTO public.system_configurations (id, tenant_id, key, value_json)
SELECT md5('acme:cfg:' || v.key)::uuid, 'a0000000-0000-0000-0000-000000000001', v.key, v.value_json::jsonb
FROM (VALUES
  ('platform.locale',                  '"es"'),
  ('platform.timezone',                '"America/Mexico_City"'),
  ('security.password_policy',         '{"min_length":8,"require_uppercase":true,"require_number":true,"require_special":false,"max_age_days":90}'),
  ('security.session_timeout_minutes', '30'),
  ('modules.active',                   '["ec","pmgm","sdm","rbp","tih"]')
) AS v(key, value_json)
ON CONFLICT DO NOTHING;

-- ── TIH ─────────────────────────────────────────────────────────────────
-- Skill ids: 5c000000-0000-0000-0000-0000000000NN.
INSERT INTO public.skill_ontology (id, tenant_id, code, name, description, category)
SELECT ('5c000000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid,
       'a0000000-0000-0000-0000-000000000001', v.code, v.name, v.description, v.category
FROM (VALUES
  ( 1, 'LEADERSHIP',    'Liderazgo',                 'Capacidad de guiar equipos y tomar decisiones estratégicas',             'soft'),
  ( 2, 'COMMUNICATION', 'Comunicación Efectiva',     'Habilidad para transmitir ideas de forma clara y persuasiva',            'soft'),
  ( 3, 'JAVASCRIPT',    'JavaScript',                'Desarrollo con JavaScript ES6+, DOM, APIs del navegador',                'technical'),
  ( 4, 'TYPESCRIPT',    'TypeScript',                'Tipado estático, interfaces, generics y patrones avanzados',             'technical'),
  ( 5, 'REACT',         'React',                     'Desarrollo de interfaces con React, hooks, estado y rendimiento',        'technical'),
  ( 6, 'NODEJS',        'Node.js',                   'Backend con Node.js, Express, APIs REST y microservicios',               'technical'),
  ( 7, 'SQL_DB',        'SQL y Bases de Datos',      'Modelado relacional, queries avanzados, optimización',                   'technical'),
  ( 8, 'PYTHON',        'Python',                    'Desarrollo con Python, automatización, scripting',                       'technical'),
  ( 9, 'RECRUITING',    'Reclutamiento y Selección', 'Sourcing, entrevistas, assessment centers, employer branding',           'technical'),
  (10, 'LABOR_LAW',     'Legislación Laboral',       'Normativa laboral, contratos, compliance regulatorio',                   'technical'),
  (11, 'ONBOARDING',    'Diseño de Onboarding',      'Programas de incorporación, integración cultural, métricas de adaptación', 'technical'),
  (12, 'CONFLICT_RES',  'Resolución de Conflictos',  'Mediación, negociación, gestión de dinámicas interpersonales',           'soft'),
  (13, 'ENGLISH',       'Inglés de Negocios',        'Comunicación profesional oral y escrita en inglés',                      'language')
) AS v(n, code, name, description, category)
ON CONFLICT DO NOTHING;

-- Job role requirements: HR Director (aa…04) and Software Engineer (aa…07).
INSERT INTO public.job_role_skills (tenant_id, job_role_id, skill_id, required_proficiency_level)
SELECT 'a0000000-0000-0000-0000-000000000001',
       ('aa100000-0000-0000-0000-' || lpad(v.role_n::text, 12, '0'))::uuid,
       ('5c000000-0000-0000-0000-' || lpad(v.skill_n::text, 12, '0'))::uuid,
       v.level::smallint
FROM (VALUES
  (4, 1, 4), (4, 2, 4), (4, 9, 5), (4, 10, 4), (4, 11, 4), (4, 12, 3),
  (7, 3, 4), (7, 4, 4), (7, 5, 4), (7, 6, 3), (7, 7, 3), (7, 8, 2), (7, 2, 3)
) AS v(role_n, skill_n, level)
ON CONFLICT DO NOTHING;

-- Employee skills. manager_assessed_by is always the employee's current manager.
INSERT INTO public.employee_skills (tenant_id, user_id, skill_id, self_assessed_level, self_assessed_at,
  manager_assessed_level, manager_assessed_at, manager_assessed_by)
SELECT 'a0000000-0000-0000-0000-000000000001',
       ('e0000000-0000-0000-0000-' || lpad(v.user_n::text, 12, '0'))::uuid,
       ('5c000000-0000-0000-0000-' || lpad(v.skill_n::text, 12, '0'))::uuid,
       v.self_level::smallint,
       '2026-01-15T00:00:00Z'::timestamptz,
       v.mgr_level::smallint,
       CASE WHEN v.mgr_level IS NOT NULL THEN '2026-02-01T00:00:00Z'::timestamptz END,
       ('e0000000-0000-0000-0000-' || lpad(v.mgr_n::text, 12, '0'))::uuid
FROM (VALUES
  -- Elena (e01, CEO, no manager): self-assessment only
  ( 1,  1, 4, NULL::int, NULL::int), ( 1,  2, 5, NULL, NULL), ( 1,  9, 5, NULL, NULL), ( 1, 12, 4, NULL, NULL),
  -- Carlos (e02, CTO) assessed by Elena (e01)
  ( 2,  3, 5, 5, 1), ( 2,  4, 4, 4, 1), ( 2,  6, 4, 3, 1), ( 2,  7, 3, 3, 1), ( 2,  1, 3, NULL, NULL),
  -- Ana (e04, HR Director) assessed by Elena (e01)
  ( 4,  9, 5, 5, 1), ( 4, 10, 4, 3, 1), ( 4, 11, 4, NULL, NULL), ( 4, 12, 4, 4, 1),
  -- Pedro (e05, Frontend Lead) assessed by Carlos (e02)
  ( 5,  3, 5, 5, 2), ( 5,  5, 5, 4, 2), ( 5,  1, 3, 3, 2),
  -- Roberto (e07, Frontend Engineer) assessed by Pedro (e05)
  ( 7,  3, 4, 4, 5), ( 7,  4, 3, 3, 5), ( 7,  5, 4, NULL, NULL),
  -- Sofía (e08, Backend Engineer): self-assessment only
  ( 8,  6, 4, NULL, NULL), ( 8,  7, 4, NULL, NULL), ( 8,  8, 3, NULL, NULL),
  -- Gabriela (e11, Frontend Developer) assessed by Pedro (e05)
  (11,  3, 3, 3, 5), (11,  5, 3, 2, 5), (11, 13, 4, NULL, NULL)
) AS v(user_n, skill_n, self_level, mgr_level, mgr_n)
ON CONFLICT DO NOTHING;

-- ── Membership for Elena's auth user, only if it exists ────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = 'f0000000-0000-0000-0000-000000000001') THEN
    INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role)
    VALUES ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'admin')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.user_settings (user_id, active_tenant_id)
    VALUES ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ── Self-check ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tenant constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND slug = 'acme-corp') THEN
    RAISE EXCEPTION 'seed.sql: demo tenant acme-corp (%) is missing', v_tenant;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = v_tenant
      AND is_ec_active AND is_pmgm_active AND is_sdm_active AND is_tih_active AND is_pos_mgmt_active
  ) THEN
    RAISE EXCEPTION 'seed.sql: demo modules (ec, pmgm, sdm, tih, pos_mgmt) are not active in acme-corp';
  END IF;

  SELECT count(*) INTO v_count FROM public.users WHERE tenant_id = v_tenant;
  IF v_count <> 25 THEN
    RAISE EXCEPTION 'seed.sql: expected 25 users in acme-corp, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.ec_job_information
  WHERE tenant_id = v_tenant AND end_date IS NULL;
  IF v_count <> 25 THEN
    RAISE EXCEPTION 'seed.sql: expected 25 current ec_job_information rows, found %', v_count;
  END IF;

  SELECT count(DISTINCT manager_id) INTO v_count FROM public.ec_job_information
  WHERE tenant_id = v_tenant AND end_date IS NULL AND manager_id IS NOT NULL;
  IF v_count < 3 THEN
    RAISE EXCEPTION 'seed.sql: expected at least 3 distinct managers, found %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_grants rg
    JOIN public.permission_roles pr ON pr.id = rg.role_id AND pr.is_admin_role
    JOIN public.group_members gm ON gm.group_id = rg.granted_group_id
    WHERE rg.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'seed.sql: no admin role grant with group members in acme-corp';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.skill_ontology WHERE tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'seed.sql: skill_ontology is empty for acme-corp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_role_skills WHERE tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'seed.sql: job_role_skills is empty for acme-corp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employee_skills WHERE tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'seed.sql: employee_skills is empty for acme-corp';
  END IF;
END $$;

COMMIT;
