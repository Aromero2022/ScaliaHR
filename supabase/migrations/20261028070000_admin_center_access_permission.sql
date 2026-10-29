-- Corrective migration: add admin_center.access permission for all existing
-- tenants.  Granted to every admin role (is_admin_role = true), which covers
-- Owner and HR Administrator.  The action is 'view' — it gates entry into
-- the Admin Center section, not any write operation.

INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
SELECT pr.tenant_id, pr.id, 'admin_center.access', 'view'::public.rbp_action
FROM   public.permission_roles pr
WHERE  pr.is_admin_role = true
ON CONFLICT DO NOTHING;
