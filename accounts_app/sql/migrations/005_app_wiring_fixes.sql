-- 005 — columns and tables the app already uses but no SQL file created.
-- Safe to re-run. Run once in the Supabase SQL editor after 001–004.
SET search_path TO accounts_erp, public;

-- Proforma -> tax invoice conversion writes the old PI number here. Without the
-- column the conversion update fails, so the proforma never becomes an invoice.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS proforma_number text;

-- B2B/B2C lock per invoice (was only in sql/party_gstin_snapshot.sql, which the
-- README's setup steps never mention).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS party_gstin_snapshot text;

-- Settings -> Audit Trail and GST -> GSTR-3B "Save Review Snapshot" read these.
-- They existed only in databases built before the scope-reduction cleanup, so a
-- fresh install showed "relation does not exist" on both screens.
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  user_email  text,
  action      text,
  table_name  text,
  record_id   uuid,
  summary     text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_biz_time ON audit_log(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gst_return_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  return_type text NOT NULL,
  period      text NOT NULL,
  status      text DEFAULT 'reviewed',
  payload     jsonb,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE gst_return_snapshots ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uidx_gst_return_snapshots
  ON gst_return_snapshots (business_id, return_type, period);

-- Invoice numbers: your SALES series must be unique per business, but purchase
-- bills carry each SUPPLIER's own number, so two suppliers both using "001" is
-- normal. The old single index (business_id, invoice_number) rejected that.
DROP INDEX IF EXISTS uidx_invoices_number;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_invoices_number_sale
  ON invoices (business_id, invoice_number) WHERE type <> 'purchase';
CREATE UNIQUE INDEX IF NOT EXISTS uidx_invoices_number_purchase
  ON invoices (business_id, party_id, invoice_number) WHERE type = 'purchase';

-- Optional clean-up: journal entries whose payment / expense / bank row /
-- purchase bill was deleted before this release (the app now removes them on
-- delete). Run the SELECT first to see what would go; uncomment the DELETE if
-- the list looks right.
SELECT je.id, je.source, je.entry_date, je.reference, je.description
FROM journal_entries je
WHERE (je.source = 'payment'       AND NOT EXISTS (SELECT 1 FROM payments p          WHERE p.id = je.source_id))
   OR (je.source = 'expense'       AND NOT EXISTS (SELECT 1 FROM expenses e          WHERE e.id = je.source_id))
   OR (je.source = 'bank_import'   AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.id = je.source_id))
   OR (je.source = 'purchase_bill' AND NOT EXISTS (SELECT 1 FROM invoices i          WHERE i.id = je.source_id AND i.status <> 'cancelled'))
ORDER BY je.entry_date;

-- DELETE FROM journal_entries je
-- WHERE (je.source = 'payment'       AND NOT EXISTS (SELECT 1 FROM payments p          WHERE p.id = je.source_id))
--    OR (je.source = 'expense'       AND NOT EXISTS (SELECT 1 FROM expenses e          WHERE e.id = je.source_id))
--    OR (je.source = 'bank_import'   AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.id = je.source_id))
--    OR (je.source = 'purchase_bill' AND NOT EXISTS (SELECT 1 FROM invoices i          WHERE i.id = je.source_id AND i.status <> 'cancelled'));
