-- D38 — Index for the employee list (Phase 9b, PR 5)
--
-- /employees shows 20 active employees of the tenant ordered by last name.
-- Without this index Postgres reads every employee of the tenant and sorts
-- them on each page view (1,000 rows in the load test tenant, more in a large
-- customer); with it, it reads the first 20 in order. Partial: the list only
-- shows active, not deleted, employees. Expand-only: nothing else changes.
CREATE INDEX d38_users_active_by_name ON public.users (tenant_id, last_name, first_name)
  WHERE deleted_at IS NULL AND status = 'ACTIVE';
