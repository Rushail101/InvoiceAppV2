-- ============================================================
-- Needle Point ERP — scope-reduction teardown
-- Run this ONCE, top to bottom, in the Supabase SQL editor.
--
-- Keeps: core invoicing/GST/accounting, purchase bills + ITC,
--        credit/debit notes, delivery challans, bank automation,
--        audit_log, gst_return_snapshots (GSTR-3B).
-- Removes: RBAC/RLS (auth_rls_phase12.sql), production orders,
--        PO->GRN->Bill chain, sales orders, quotations,
--        cost centres/projects, GST amendments, GSTR-2B matching,
--        automation exceptions, warehouses/stock ledger.
--
-- IMPORTANT: back up first. In Supabase: Database -> Backups,
-- or at minimum export these tables to CSV before running.
-- ============================================================

SET search_path TO accounts_erp, public;

-- ============================================================
-- STEP 1 — Tear down Phase 12 RLS/RBAC first.
-- Must happen before dropping user_business_roles: every policy
-- on the tables you're KEEPING calls has_business_access(), which
-- queries user_business_roles. Drop the table first and every one
-- of those policies starts erroring -> the whole app locks out,
-- not just the removed features.
--
-- This reverts you to the pre-Phase-12 state: RLS off, access
-- controlled by whoever holds your Supabase anon/service key (same
-- as before RBAC was introduced). Fine for a private app with no
-- public signup. If you want real multi-user isolation later
-- without the full 5-role system, say so and we'll add a single
-- lightweight "business_members" check instead.
-- ============================================================

-- Drop every policy in the schema (names vary by table; this is
-- one clean sweep instead of hunting each one down individually)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'accounts_erp'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON accounts_erp.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Disable RLS everywhere it was turned on
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'parties','items','invoices','payments','expenses','accounts',
    'journal_entries','credit_notes','debit_notes','bank_accounts',
    'bank_transactions','delivery_challans','businesses',
    'invoice_items','journal_lines','credit_note_items','debit_note_items',
    'delivery_challan_items','audit_log','gst_return_snapshots',
    'gst_2b_records','gst_reconciliation','warehouses','stock_ledger',
    'purchase_orders','purchase_order_items','grns','grn_items',
    'quotations','quotation_items','sales_orders','sales_order_items',
    'gst_amendments','user_business_roles','production_orders',
    'production_materials','production_events','cost_centres','projects',
    'automation_exceptions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS accounts_erp.%I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Bootstrap trigger + the three access-check functions from Phase 12
DROP TRIGGER IF EXISTS business_owner_bootstrap ON accounts_erp.businesses;
DROP FUNCTION IF EXISTS accounts_erp.bootstrap_business_owner();
DROP FUNCTION IF EXISTS accounts_erp.has_business_role(uuid, text[]);
DROP FUNCTION IF EXISTS accounts_erp.has_business_access(uuid);

-- ============================================================
-- STEP 2 — Drop columns on tables you're KEEPING that only exist
-- to support cost centres/projects (must happen before dropping
-- those two tables, since invoices/expenses/journal_entries hold
-- FKs to them).
-- ============================================================
ALTER TABLE accounts_erp.invoices        DROP COLUMN IF EXISTS cost_centre_id;
ALTER TABLE accounts_erp.invoices        DROP COLUMN IF EXISTS project_id;
ALTER TABLE accounts_erp.expenses        DROP COLUMN IF EXISTS cost_centre_id;
ALTER TABLE accounts_erp.expenses        DROP COLUMN IF EXISTS project_id;
ALTER TABLE accounts_erp.journal_entries DROP COLUMN IF EXISTS cost_centre_id;
ALTER TABLE accounts_erp.journal_entries DROP COLUMN IF EXISTS project_id;

-- ============================================================
-- STEP 3 — Drop the tables themselves. Children before parents.
-- ============================================================

-- Production (duplicates the Needle Point garment-production ERP)
DROP TABLE IF EXISTS accounts_erp.production_events;
DROP TABLE IF EXISTS accounts_erp.production_materials;
DROP TABLE IF EXISTS accounts_erp.production_orders;

-- Purchase orders / GRN chain
DROP TABLE IF EXISTS accounts_erp.grn_items;
DROP TABLE IF EXISTS accounts_erp.grns;
DROP TABLE IF EXISTS accounts_erp.purchase_order_items;
DROP TABLE IF EXISTS accounts_erp.purchase_orders;

-- Sales orders / Quotations
DROP TABLE IF EXISTS accounts_erp.sales_order_items;
DROP TABLE IF EXISTS accounts_erp.sales_orders;
DROP TABLE IF EXISTS accounts_erp.quotation_items;
DROP TABLE IF EXISTS accounts_erp.quotations;

-- Inventory / Warehouses (parking this — link to Needle Point ERP later instead)
DROP TABLE IF EXISTS accounts_erp.stock_ledger;
DROP TABLE IF EXISTS accounts_erp.warehouses;

-- GSTR-1A amendment staging
DROP TABLE IF EXISTS accounts_erp.gst_amendments;

-- GSTR-2B auto-matching (keeping gst_return_snapshots / GSTR-3B — not part of this)
DROP TABLE IF EXISTS accounts_erp.gst_reconciliation;
DROP TABLE IF EXISTS accounts_erp.gst_2b_records;

-- Cost centres / Projects
DROP TABLE IF EXISTS accounts_erp.cost_centres;
DROP TABLE IF EXISTS accounts_erp.projects;

-- Automation exceptions tracker
DROP TABLE IF EXISTS accounts_erp.automation_exceptions;

-- RBAC (last — nothing above depends on it once Step 1 ran)
DROP TABLE IF EXISTS accounts_erp.user_business_roles;

-- ============================================================
-- STEP 4 — Verify what's left
-- ============================================================
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'accounts_erp' ORDER BY table_name;
-- Expect exactly: accounts, audit_log, bank_accounts, bank_transactions,
-- businesses, credit_note_items, credit_notes, debit_note_items,
-- debit_notes, delivery_challan_items, delivery_challans, expenses,
-- gst_return_snapshots, invoice_items, invoices, items, journal_entries,
-- journal_lines, parties, payments

SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'accounts_erp';
-- Expect: zero rows
