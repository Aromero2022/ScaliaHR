-- Tenant admins could hard-delete permission groups, roles, role permissions
-- and system configurations (deleting a group also cascaded to its grants).
-- Project rule: no DELETE for authenticated, soft delete only. Drop the
-- permissive DELETE policies and add the same RESTRICTIVE block used on the
-- other business tables.

DROP POLICY IF EXISTS "permission_groups_delete" ON public.permission_groups;
DROP POLICY IF EXISTS "permission_roles_delete" ON public.permission_roles;
DROP POLICY IF EXISTS "role_permissions_delete" ON public.role_permissions;
DROP POLICY IF EXISTS "system_configurations_delete" ON public.system_configurations;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'permission_groups', 'permission_roles', 'role_permissions', 'system_configurations'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
        AND policyname = 'no_hard_delete_authenticated'
    ) THEN
      EXECUTE format(
        'CREATE POLICY no_hard_delete_authenticated ON public.%I
         AS RESTRICTIVE FOR DELETE TO authenticated USING (false)',
        tbl
      );
    END IF;
  END LOOP;
END $$;
