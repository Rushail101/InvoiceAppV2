-- Run in the OPERATIONS project right after restoring the accounts_erp schema
-- into it (MERGE_GUIDE.md step 3). pg_restore --no-privileges drops the
-- permissions Supabase's API roles need; this puts them back. Safe to re-run.
GRANT USAGE ON SCHEMA accounts_erp TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA accounts_erp TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA accounts_erp TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA accounts_erp TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA accounts_erp GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA accounts_erp GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA accounts_erp GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
