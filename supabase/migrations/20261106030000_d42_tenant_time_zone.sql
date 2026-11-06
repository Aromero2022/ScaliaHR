-- D42 — Tenant time zone for the server's date formatting (Phase 9c, PR 3)
--
-- The web server formats dates with the tenant's time zone, the
-- 'platform.timezone' key of system_configurations. The SELECT policy of that
-- table lets only tenant admins read it, so an employee's session cannot, and
-- the server caches the zone per tenant (tag tenant:<id>:time-zone) outside
-- any request. This function returns only that one value of one tenant, for
-- the server's prisma_app role; the server passes the tenant id from its own
-- context. No other key, no key parameter, no row. system_configurations has
-- no deleted_at column. Expand-only: no column, policy or seed row changes.

CREATE FUNCTION public.tenant_time_zone(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.value_json #>> '{}'
  FROM public.system_configurations c
  WHERE c.tenant_id = p_tenant_id
    AND c.key = 'platform.timezone';
$$;

REVOKE ALL ON FUNCTION public.tenant_time_zone(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_time_zone(uuid) TO prisma_app;
