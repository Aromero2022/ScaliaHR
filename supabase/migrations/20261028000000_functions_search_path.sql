-- Supabase advisor "Function Search Path Mutable": every function in public
-- runs with a fixed, empty search_path. The bodies of these three already use
-- schema-qualified names (or only pg_catalog builtins), so behaviour is unchanged.
ALTER FUNCTION public.compute_arco_due_date(date) SET search_path = '';
ALTER FUNCTION public.current_app_user_id() SET search_path = '';
ALTER FUNCTION public.has_app_role(text) SET search_path = '';
