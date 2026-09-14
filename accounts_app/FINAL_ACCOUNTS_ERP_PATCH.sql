-- Needle Point ERP — final safe incremental patch
-- Run after the existing accounts_erp 1–16 migration.
-- Non-destructive: no DROP TABLE / TRUNCATE / DELETE.

CREATE SCHEMA IF NOT EXISTS accounts_erp;
SET search_path TO accounts_erp, public;

-- Phase 15: allow transactions to be tagged to projects as well as cost centres.
ALTER TABLE accounts_erp.expenses
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES accounts_erp.projects(id) ON DELETE SET NULL;

ALTER TABLE accounts_erp.journal_entries
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES accounts_erp.projects(id) ON DELETE SET NULL;

ALTER TABLE accounts_erp.invoices
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES accounts_erp.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_project
  ON accounts_erp.expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_project
  ON accounts_erp.journal_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_project
  ON accounts_erp.invoices(project_id);

-- Phase 11: extend the audit trail to the operational documents added in later phases.
CREATE OR REPLACE FUNCTION accounts_erp.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = accounts_erp, public
AS $$
DECLARE
  bid uuid;
  rid uuid;
BEGIN
  bid := COALESCE(NEW.business_id, OLD.business_id);
  rid := COALESCE(NEW.id, OLD.id);

  INSERT INTO accounts_erp.audit_log
  (business_id,user_id,user_email,action,table_name,record_id,old_data,new_data,summary)
  VALUES
  (bid,auth.uid(),COALESCE(auth.email(),''),TG_OP,TG_TABLE_NAME,rid,
   CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
   CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,
   TG_TABLE_NAME || ' ' || lower(TG_OP));

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'purchase_orders','grns','quotations','sales_orders',
    'gst_amendments','production_orders','cost_centres','projects',
    'automation_exceptions','warehouses','stock_ledger',
    'gst_2b_records','gst_reconciliation','gst_return_snapshots'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON accounts_erp.%I', t, t);
    EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON accounts_erp.%I FOR EACH ROW EXECUTE FUNCTION accounts_erp.audit_row_change()', t, t);
  END LOOP;
END $$;

-- Keep bank imports explicitly unreconciled until reconciliation is confirmed.
ALTER TABLE accounts_erp.bank_transactions
  ADD COLUMN IF NOT EXISTS journal_posted boolean DEFAULT false;

-- Useful indexes for the automation/reconciliation engine.
CREATE INDEX IF NOT EXISTS idx_bank_txn_payment
  ON accounts_erp.bank_transactions(payment_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_party
  ON accounts_erp.bank_transactions(party_id);
CREATE INDEX IF NOT EXISTS idx_gst_recon_2b
  ON accounts_erp.gst_reconciliation(gst_2b_id);

-- Verification
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'accounts_erp'
  AND ((table_name IN ('expenses','journal_entries','invoices') AND column_name = 'project_id')
    OR (table_name = 'bank_transactions' AND column_name = 'journal_posted'))
ORDER BY table_name, column_name;
