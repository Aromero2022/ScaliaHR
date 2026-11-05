-- D28 — Rate limiting (Phase 9b, PR 3)
--
-- The web server spends one token per attempt before login, MFA, tenant
-- creation, every write Server Action and the HTTP routes. It calls
-- rate_limit_consume() through prisma_app (server-only connection), so the
-- check works before there is a session and no Data API client can drain or
-- reset somebody else's bucket. Keys arrive hashed: no email or IP is stored.

-- ─── 1. check_rate_limit goes ──────────────────────────────────────────────
-- It answered only allowed/denied and authenticated could call it with any
-- key. Expand/contract: neither the running image nor the rollback image calls
-- it (lib/rate-limit.ts had no callers before this change).
DROP FUNCTION public.check_rate_limit(text, text, integer, integer);

-- ─── 2. Per-tenant limits, edited from Admin Center ─────────────────────────
-- Only the 'write' (Server Actions) and 'api' (HTTP routes) buckets: login,
-- MFA and tenant creation protect authentication itself and keep the
-- platform's fixed limits. The bounds stop a tenant from switching limits off.
CREATE TABLE public.tenant_rate_limits (
  tenant_id      uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  action         text        NOT NULL CHECK (action IN ('write', 'api')),
  max_tokens     integer     NOT NULL CHECK (max_tokens BETWEEN 1 AND 600),
  window_seconds integer     NOT NULL CHECK (window_seconds BETWEEN 10 AND 3600),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, action)
);

ALTER TABLE public.tenant_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_rate_limits FORCE ROW LEVEL SECURITY;

-- Tenant admins read and change their own tenant's limits; no DELETE policy:
-- going back to the default is an update to the default values.
CREATE POLICY tenant_rate_limits_select ON public.tenant_rate_limits
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.requesting_tenant_id()) AND (SELECT public.is_tenant_admin()));
CREATE POLICY tenant_rate_limits_insert ON public.tenant_rate_limits
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT public.requesting_tenant_id()) AND (SELECT public.is_tenant_admin()));
CREATE POLICY tenant_rate_limits_update ON public.tenant_rate_limits
  FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT public.requesting_tenant_id()) AND (SELECT public.is_tenant_admin()))
  WITH CHECK (tenant_id = (SELECT public.requesting_tenant_id()) AND (SELECT public.is_tenant_admin()));

REVOKE ALL ON public.tenant_rate_limits FROM anon;
REVOKE ALL ON public.tenant_rate_limits FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenant_rate_limits TO authenticated;

-- ─── 3. rate_limit_consume ──────────────────────────────────────────────────
-- Fixed window per (key, action). Returns 0 when the attempt is allowed, or
-- the seconds until the window resets (the Retry-After value) when it is not.
-- With p_tenant_id, the tenant's own limit for that action replaces the
-- default. About one call in a hundred deletes windows older than a day, the
-- longest window allowed, so the table does not grow without bound.
CREATE FUNCTION public.rate_limit_consume(
  p_key            text,
  p_action         text,
  p_max_tokens     integer,
  p_window_seconds integer,
  p_tenant_id      uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now    timestamptz := now();
  v_max    integer := p_max_tokens;
  v_window integer := p_window_seconds;
  v_tokens integer;
  v_start  timestamptz;
BEGIN
  IF p_tenant_id IS NOT NULL THEN
    SELECT l.max_tokens, l.window_seconds INTO v_max, v_window
    FROM public.tenant_rate_limits l
    WHERE l.tenant_id = p_tenant_id AND l.action = p_action;
    IF NOT FOUND THEN
      v_max := p_max_tokens;
      v_window := p_window_seconds;
    END IF;
  END IF;

  IF v_max < 1 OR v_window NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'rate_limit_consume: invalid limit % per % s', v_max, v_window
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rate_limits AS r (key, action, tokens, window_start)
  VALUES (p_key, p_action, 1, v_now)
  ON CONFLICT (key, action) DO UPDATE SET
    tokens = CASE WHEN r.window_start <= v_now - make_interval(secs => v_window) THEN 1 ELSE r.tokens + 1 END,
    window_start = CASE WHEN r.window_start <= v_now - make_interval(secs => v_window) THEN v_now ELSE r.window_start END
  RETURNING r.tokens, r.window_start INTO v_tokens, v_start;

  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < v_now - interval '1 day';
  END IF;

  IF v_tokens <= v_max THEN
    RETURN 0;
  END IF;
  RETURN greatest(1, ceil(extract(epoch FROM v_start + make_interval(secs => v_window) - v_now))::integer);
END;
$$;

-- Supabase's default privileges grant EXECUTE on new functions to anon,
-- authenticated and service_role; only the server's prisma_app keeps it.
REVOKE EXECUTE ON FUNCTION public.rate_limit_consume(text, text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rate_limit_consume(text, text, integer, integer, uuid) TO prisma_app;
