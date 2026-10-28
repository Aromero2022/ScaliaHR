-- write_audit_log() trusted the tenant and actor passed by the caller, and
-- authenticated could also INSERT into audit_logs directly: any user could
-- record entries on behalf of someone else or in another tenant.
-- The function now ignores p_tenant_id / p_actor_id (kept for compatibility)
-- and always records requesting_tenant_id() and current_app_user_id().
-- audit_logs is written only through this function.

CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_tenant_id  uuid,
  p_actor_id   uuid,
  p_action     text,
  p_entity     text DEFAULT NULL,
  p_entity_id  text DEFAULT NULL,
  p_diff       jsonb DEFAULT NULL,
  p_ip         inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid := public.requesting_tenant_id();
  v_actor_id  uuid := public.current_app_user_id();
  v_id        uuid;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'write_audit_log requires a signed-in user of a tenant'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, entity, entity_id, diff, ip, user_agent
  ) VALUES (
    v_tenant_id, v_actor_id, p_action, p_entity, p_entity_id, p_diff, p_ip, p_user_agent
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log(uuid, uuid, text, text, text, jsonb, inet, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit_log(uuid, uuid, text, text, text, jsonb, inet, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.write_audit_log(uuid, uuid, text, text, text, jsonb, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(uuid, uuid, text, text, text, jsonb, inet, text) TO service_role;

DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
REVOKE INSERT ON public.audit_logs FROM anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prisma_app') THEN
    REVOKE INSERT ON public.audit_logs FROM prisma_app;
  END IF;
END $$;
