-- Supabase advisor "Extension in Public": btree_gist was created in public by
-- the first migrations. Move it to the extensions schema; the EXCLUDE
-- constraints reference its operator classes by OID and keep working.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension
    WHERE extname = 'btree_gist' AND extnamespace <> 'extensions'::regnamespace
  ) THEN
    ALTER EXTENSION btree_gist SET SCHEMA extensions;
  END IF;
END $$;
