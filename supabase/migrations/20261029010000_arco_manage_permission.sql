-- Add arco.manage permission for admin roles (Owner, HR Administrator).
-- Used by the ARCO page to gate access via can() instead of a hardcoded
-- group_members UUID check.

INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, action)
SELECT pr.tenant_id, pr.id, 'arco.manage', 'view'::public.rbp_action
FROM   public.permission_roles pr
WHERE  pr.is_admin_role = true
ON CONFLICT DO NOTHING;
