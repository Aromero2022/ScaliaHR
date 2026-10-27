-- GoTrue calls custom_access_token_hook as supabase_auth_admin. EXECUTE alone
-- is not enough: the role must be able to resolve the function in schema
-- public, otherwise every sign-in fails with "Error running hook URI".
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
