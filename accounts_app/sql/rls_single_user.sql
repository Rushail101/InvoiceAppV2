-- ============================================================
-- Single-owner Row Level Security for the accounts_erp schema
--
-- NOT RUN AUTOMATICALLY. Read this whole header, then run the steps
-- one at a time in the Supabase SQL editor.
--
-- WHY: the Supabase anon key is visible in the browser, so with RLS off
-- anyone who has it can read/write every table directly, bypassing the
-- app's login screen entirely. This locks the schema so that only ONE
-- signed-in Supabase Auth user (you) can touch any row.
--
-- !! BEFORE ENABLING (step 3) !!
--   a) Create your user: Supabase -> Authentication -> Users -> Add user
--      (email + password). Copy its UUID.
--   b) Sign in to the app with that EMAIL + password (the login screen uses
--      Supabase Auth whenever the username contains "@"). The old
--      VITE_APP_USERNAME/PASSWORD fallback has NO Supabase session, so once RLS
--      is on it would see empty tables / get permission errors.
--   c) Make sure the schema is exposed: Settings -> API -> Exposed schemas
--      includes accounts_erp (it must already, or the app wouldn't work).
--
-- ROLLBACK: see the last section.
-- ============================================================

SET search_path TO accounts_erp, public;

-- ------------------------------------------------------------
-- STEP 0 — Where do you stand today? (read-only)
-- Shows, per table, whether RLS is on and how many policies exist.
-- If every row says rls_enabled = false, the database is currently open
-- to anyone holding the anon key.
-- ------------------------------------------------------------
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'accounts_erp' AND p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'accounts_erp' AND c.relkind = 'r'
ORDER BY c.relname;

-- ------------------------------------------------------------
-- STEP 1 — Record who the owner is.
-- Replace the UUID below with the one you copied in (a).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_owner (
  user_id uuid PRIMARY KEY
);
-- The owner table itself must not be readable/writable by the anon key either (step 3 covers it).

-- >>> EDIT THIS LINE <<<
INSERT INTO app_owner (user_id) VALUES ('00000000-0000-0000-0000-000000000000')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- STEP 2 — Helper used by every policy.
-- SECURITY DEFINER so the check can read app_owner even though app_owner is itself locked.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION accounts_erp.is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = accounts_erp, public AS $$
  SELECT EXISTS (SELECT 1 FROM accounts_erp.app_owner WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION accounts_erp.is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounts_erp.is_owner() TO authenticated;

-- ------------------------------------------------------------
-- STEP 3 — Turn RLS on for EVERY table in the schema and allow only the owner.
-- Loops over whatever tables actually exist, so nothing is missed or
-- errors on a table you don't have. Existing policies are replaced.
-- (This is the step that makes the old env-var login stop working.)
-- ------------------------------------------------------------
DO $$
DECLARE r record; pol record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'accounts_erp' LOOP
    -- drop every existing policy on the table (e.g. leftovers from earlier phases)
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'accounts_erp' AND tablename = r.tablename LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON accounts_erp.%I', pol.policyname, r.tablename);
    END LOOP;
    EXECUTE format('ALTER TABLE accounts_erp.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format(
      'CREATE POLICY owner_only ON accounts_erp.%I FOR ALL TO authenticated USING (accounts_erp.is_owner()) WITH CHECK (accounts_erp.is_owner())',
      r.tablename);
    -- the anon role gets nothing at all
    EXECUTE format('REVOKE ALL ON accounts_erp.%I FROM anon', r.tablename);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- STEP 4 — Verify (read-only). Every table should show rls_enabled = true, policies = 1.
-- Then reload the app signed in with your email: data should load as before.
-- ------------------------------------------------------------
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'accounts_erp' AND p.tablename = c.relname) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'accounts_erp' AND c.relkind = 'r'
ORDER BY c.relname;

-- ------------------------------------------------------------
-- ROLLBACK — if the app can't load data after step 3 (usually: you're not signed in with the
-- Supabase email account). Restores the open state. Run only if needed.
-- ------------------------------------------------------------
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'accounts_erp' LOOP
--     EXECUTE format('DROP POLICY IF EXISTS owner_only ON accounts_erp.%I', r.tablename);
--     EXECUTE format('ALTER TABLE accounts_erp.%I DISABLE ROW LEVEL SECURITY', r.tablename);
--     EXECUTE format('GRANT ALL ON accounts_erp.%I TO anon', r.tablename);
--   END LOOP;
-- END $$;
