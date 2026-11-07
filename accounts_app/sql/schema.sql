-- ═══════════════════════════════════════════════════════════
-- Accounts ERP — Full Schema + Migration
-- Run this in Supabase SQL Editor (safe to re-run — uses IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════

-- ── STEP 1: Core tables ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS businesses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  address      text,
  gstin        text,
  state        text,
  phone        text,
  email        text,
  bank_account text,
  ifsc_code    text,
  bank_name    text,
  upi_id       text,
  logo_url     text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'client',
  phone       text,
  email       text,
  gstin       text,
  address     text,
  state       text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name           text NOT NULL,
  brand          text,
  category       text,
  hsn_code       text,
  unit           text DEFAULT 'Pcs',
  sale_price     numeric(12,2) DEFAULT 0,
  purchase_price numeric(12,2) DEFAULT 0,
  tax_percent    numeric(5,2)  DEFAULT 5,
  description    text,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid REFERENCES businesses(id) ON DELETE CASCADE,
  party_id         uuid REFERENCES parties(id) ON DELETE SET NULL,
  invoice_number   text NOT NULL,
  type             text NOT NULL DEFAULT 'sale',
  status           text NOT NULL DEFAULT 'draft',
  issue_date       date,
  due_date         date,
  notes            text,
  discount_percent numeric(5,2)  DEFAULT 0,
  discount_amount  numeric(12,2) DEFAULT 0,
  subtotal         numeric(12,2) DEFAULT 0,
  cgst_amount      numeric(12,2) DEFAULT 0,
  sgst_amount      numeric(12,2) DEFAULT 0,
  igst_amount      numeric(12,2) DEFAULT 0,
  tax_amount       numeric(12,2) DEFAULT 0,
  total            numeric(12,2) DEFAULT 0,
  is_interstate    boolean DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid REFERENCES invoices(id) ON DELETE CASCADE,
  description      text,
  hsn_code         text,
  quantity         numeric(10,2) DEFAULT 1,
  unit_price       numeric(12,2) DEFAULT 0,
  discount_percent numeric(5,2)  DEFAULT 0,
  taxable_amount   numeric(12,2) DEFAULT 0,
  tax_percent      numeric(5,2)  DEFAULT 0,
  cgst_amount      numeric(12,2) DEFAULT 0,
  sgst_amount      numeric(12,2) DEFAULT 0,
  igst_amount      numeric(12,2) DEFAULT 0,
  amount           numeric(12,2) DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id   uuid REFERENCES invoices(id) ON DELETE CASCADE,
  party_id     uuid REFERENCES parties(id) ON DELETE SET NULL,
  amount       numeric(12,2) NOT NULL,
  payment_date date NOT NULL,
  method       text,
  reference    text,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid REFERENCES businesses(id) ON DELETE CASCADE,
  vendor_id    uuid REFERENCES parties(id) ON DELETE SET NULL,
  category     text NOT NULL,
  description  text,
  amount       numeric(12,2) NOT NULL,
  expense_date date NOT NULL,
  method       text,
  reference    text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  "group"     text NOT NULL,
  sub_group   text,
  description text,
  is_system   boolean DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(business_id, code)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  entry_date  date NOT NULL,
  reference   text,
  description text NOT NULL,
  narration   text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  type       text NOT NULL,
  amount     numeric(12,2) NOT NULL,
  narration  text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id  uuid REFERENCES invoices(id) ON DELETE SET NULL,
  party_id    uuid REFERENCES parties(id) ON DELETE SET NULL,
  cn_number   text NOT NULL,
  cn_date     date NOT NULL,
  reason      text,
  notes       text,
  cgst_amount numeric(12,2) DEFAULT 0,
  sgst_amount numeric(12,2) DEFAULT 0,
  igst_amount numeric(12,2) DEFAULT 0,
  is_interstate boolean DEFAULT false,
  subtotal    numeric(12,2) DEFAULT 0,
  tax_amount  numeric(12,2) DEFAULT 0,
  total       numeric(12,2) DEFAULT 0,
  status      text DEFAULT 'active',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid REFERENCES credit_notes(id) ON DELETE CASCADE,
  description    text,
  hsn_code       text,
  quantity       numeric(10,2) DEFAULT 1,
  unit_price     numeric(12,2) DEFAULT 0,
  tax_percent    numeric(5,2)  DEFAULT 0,
  taxable_amount numeric(12,2) DEFAULT 0,
  cgst_amount   numeric(12,2) DEFAULT 0,
  sgst_amount   numeric(12,2) DEFAULT 0,
  igst_amount   numeric(12,2) DEFAULT 0,
  tax_amount    numeric(12,2) DEFAULT 0,
  amount        numeric(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS debit_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id     uuid REFERENCES invoices(id) ON DELETE SET NULL,
  party_id       uuid REFERENCES parties(id) ON DELETE SET NULL,
  dn_number      text NOT NULL,
  dn_date        date NOT NULL,
  reason         text,
  notes          text,
  subtotal       numeric(12,2) DEFAULT 0,
  cgst_amount    numeric(12,2) DEFAULT 0,
  sgst_amount    numeric(12,2) DEFAULT 0,
  igst_amount    numeric(12,2) DEFAULT 0,
  tax_amount     numeric(12,2) DEFAULT 0,
  total          numeric(12,2) DEFAULT 0,
  is_interstate  boolean DEFAULT false,
  status         text DEFAULT 'issued',
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS debit_note_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debit_note_id  uuid REFERENCES debit_notes(id) ON DELETE CASCADE,
  description    text NOT NULL,
  hsn_code       text,
  quantity       numeric(10,2) DEFAULT 1,
  unit_price     numeric(12,2) DEFAULT 0,
  tax_percent    numeric(5,2) DEFAULT 0,
  taxable_amount numeric(12,2) DEFAULT 0,
  cgst_amount    numeric(12,2) DEFAULT 0,
  sgst_amount    numeric(12,2) DEFAULT 0,
  igst_amount    numeric(12,2) DEFAULT 0,
  tax_amount     numeric(12,2) DEFAULT 0,
  amount         numeric(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name            text NOT NULL,
  account_number  text,
  ifsc_code       text,
  bank_name       text,
  opening_balance numeric(12,2) DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE CASCADE,
  txn_date        date NOT NULL,
  description     text,
  amount          numeric(12,2) NOT NULL,
  type            text,
  reference       text,
  reconciled      boolean DEFAULT false,
  party_id        uuid REFERENCES parties(id) ON DELETE SET NULL,
  payment_id      uuid REFERENCES payments(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_challans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  party_id          uuid NOT NULL REFERENCES parties(id),
  linked_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  challan_number    text NOT NULL,
  challan_date      date NOT NULL,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','dispatched','delivered','cancelled')),
  purpose           text NOT NULL DEFAULT 'Supply of Goods',
  transport_mode    text,
  vehicle_number    text,
  lr_number         text,
  driver_name       text,
  dispatch_from     text,
  dispatch_to       text,
  eway_bill_number  text,
  subtotal          numeric(14,2) NOT NULL DEFAULT 0,
  cgst_amount       numeric(14,2) NOT NULL DEFAULT 0,
  sgst_amount       numeric(14,2) NOT NULL DEFAULT 0,
  igst_amount       numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount        numeric(14,2) NOT NULL DEFAULT 0,
  total             numeric(14,2) NOT NULL DEFAULT 0,
  is_interstate     boolean NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_challan_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id       uuid NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
  description      text NOT NULL,
  hsn_code         text,
  unit             text NOT NULL DEFAULT 'Nos',
  quantity         numeric(12,3) NOT NULL DEFAULT 0,
  unit_price       numeric(14,2) NOT NULL DEFAULT 0,
  discount_percent numeric(5,2)  NOT NULL DEFAULT 0,
  tax_percent      numeric(5,2)  NOT NULL DEFAULT 0,
  taxable_amount   numeric(14,2) NOT NULL DEFAULT 0,
  cgst_amount      numeric(14,2) NOT NULL DEFAULT 0,
  sgst_amount      numeric(14,2) NOT NULL DEFAULT 0,
  igst_amount      numeric(14,2) NOT NULL DEFAULT 0,
  amount           numeric(14,2) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_delivery_challans ON delivery_challans;
CREATE TRIGGER set_updated_at_delivery_challans
  BEFORE UPDATE ON delivery_challans
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE delivery_challans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_challan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE debit_notes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE debit_note_items       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "challans_all" ON delivery_challans;
CREATE POLICY "challans_all" ON delivery_challans
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "challan_items_all" ON delivery_challan_items;
CREATE POLICY "challan_items_all" ON delivery_challan_items
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "debit_notes_all" ON debit_notes;
CREATE POLICY "debit_notes_all" ON debit_notes
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "debit_note_items_all" ON debit_note_items;
CREATE POLICY "debit_note_items_all" ON debit_note_items
  FOR ALL USING (true) WITH CHECK (true);

-- ── STEP 2: Migration — add missing columns to existing tables ─────────────────
-- Safe to run on both new and old databases
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reconciled boolean DEFAULT false;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES parties(id) ON DELETE SET NULL;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS state text;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2)  DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount  numeric(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cgst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sgst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS igst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_interstate    boolean DEFAULT true;

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2)  DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS taxable_amount   numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cgst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sgst_amount      numeric(12,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS igst_amount      numeric(12,2) DEFAULT 0;

-- GST-filed tracking, so you can mark an invoice as filed and catch ones you miss
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst_filed        boolean DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst_filed_at     timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst_filed_period text;

-- ── STEP 3: Indexes ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_party    ON invoices(party_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_date     ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_inv_items_inv     ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice  ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_biz      ON payments(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_biz      ON expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_parties_biz       ON parties(business_id);
CREATE INDEX IF NOT EXISTS idx_accounts_biz      ON accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_jlines_journal    ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_jlines_account    ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_cn_invoice        ON credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_dn_invoice        ON debit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_dn_party          ON debit_notes(party_id);
CREATE INDEX IF NOT EXISTS idx_dn_date           ON debit_notes(dn_date DESC);
CREATE INDEX IF NOT EXISTS idx_dn_items_dn       ON debit_note_items(debit_note_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_debit_notes_number ON debit_notes(business_id, dn_number);
CREATE INDEX IF NOT EXISTS idx_items_biz         ON items(business_id);
CREATE INDEX IF NOT EXISTS idx_challans_party    ON delivery_challans(party_id);
CREATE INDEX IF NOT EXISTS idx_challans_date     ON delivery_challans(challan_date DESC);
CREATE INDEX IF NOT EXISTS idx_challans_linked_inv ON delivery_challans(linked_invoice_id) WHERE linked_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_challan_items_challan ON delivery_challan_items(challan_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_challan_number ON delivery_challans(business_id, challan_number);

-- ── STEP 4: Seed your first business (edit values, then uncomment & run) ───────

-- INSERT INTO businesses (name, gstin, state, phone, email, address, bank_account, ifsc_code, bank_name, upi_id)
-- VALUES ('Needle Point','07AAXFN6403D1Z5','Delhi','9988998727','rushailharjai10@gmail.com',
--   'C-157, 3rd Floor, Mayapuri Industrial Area, Phase 2, New Delhi 110064',
--   '181805001556','ICIC0001818','ICICI Bank Ltd, WH-9 Mayapuri Phase 1, 110064',
--   'needlepoint.ibz@icici');

-- ── STEP 5: v6 Migration — run if upgrading from a previous version ──────────
-- Expense → Journal auto-posting
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS journal_posted boolean DEFAULT false;

-- Journal source tracking (links journal entries back to expenses)
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS source_id uuid;

-- TDS tracking on invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tds_amount numeric(12,2) DEFAULT 0;

-- Party PAN for TDS reporting
ALTER TABLE parties ADD COLUMN IF NOT EXISTS pan text;

CREATE INDEX IF NOT EXISTS idx_jentries_source ON journal_entries(source, source_id);
CREATE INDEX IF NOT EXISTS idx_expenses_journal ON expenses(journal_posted);

-- ── STEP 6: Compliance fixes ──────────────────────────────────────────────────
-- Before running the unique indexes below, check for existing duplicate
-- invoice/CN numbers — see compliance_fixes_migration.sql for the check queries.

-- Legacy compatibility: keep the old field for existing databases; the sales UI/reporting no longer exposes RCM.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reverse_charge boolean DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ship_to_address text;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS note_type text DEFAULT 'tax';
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS cgst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS sgst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS igst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS is_interstate boolean DEFAULT false;
ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS cgst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS sgst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS igst_amount numeric(12,2) DEFAULT 0;
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS eway_bill_number text;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_invoices_number ON invoices(business_id, invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_credit_notes_number ON credit_notes(business_id, cn_number);

-- Debit Notes
CREATE UNIQUE INDEX IF NOT EXISTS uidx_debit_notes_number ON debit_notes(business_id, dn_number);

-- ── STEP 7: Phase 3 — Purchase Bills + GST Input Credit ─────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS itc_eligible boolean DEFAULT true;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS itc_ineligible_reason text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS purchase_order_ref text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS grn_ref text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS journal_posted boolean DEFAULT false;

-- Input GST is recoverable tax (asset), not output tax payable.
UPDATE accounts SET "group" = 'asset', sub_group = 'Current Assets',
  description = 'Eligible GST paid on purchases (input tax credit)'
WHERE name = 'GST Input Credit';

INSERT INTO accounts (business_id, code, name, "group", sub_group, description)
SELECT b.id, '2210', 'Input CGST', 'asset', 'Current Assets', 'CGST paid on purchases eligible for ITC'
FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.business_id=b.id AND a.name='Input CGST');
INSERT INTO accounts (business_id, code, name, "group", sub_group, description)
SELECT b.id, '2220', 'Input SGST', 'asset', 'Current Assets', 'SGST paid on purchases eligible for ITC'
FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.business_id=b.id AND a.name='Input SGST');
INSERT INTO accounts (business_id, code, name, "group", sub_group, description)
SELECT b.id, '2230', 'Input IGST', 'asset', 'Current Assets', 'IGST paid on purchases eligible for ITC'
FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.business_id=b.id AND a.name='Input IGST');
INSERT INTO accounts (business_id, code, name, "group", sub_group, description)
SELECT b.id, '2140', 'GST Payable (RCM)', 'liability', 'Current Liabilities', 'GST payable under reverse charge'
FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.business_id=b.id AND a.name='GST Payable (RCM)');

CREATE INDEX IF NOT EXISTS idx_invoices_purchase ON invoices(business_id, type, issue_date) WHERE type='purchase';
CREATE INDEX IF NOT EXISTS idx_invoices_journal_posted ON invoices(journal_posted);

-- End Phase 3

-- ── Bank credit <-> payment links (also in migrations/002_bank_txn_links.sql) ──
CREATE TABLE IF NOT EXISTS bank_txn_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_txn_id uuid NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount      numeric(12,2) NOT NULL CHECK (amount > 0),
  source      text NOT NULL DEFAULT 'manual',   -- 'auto' | 'manual' | 'import' | 'created'
  created_at  timestamptz DEFAULT now(),
  UNIQUE (bank_txn_id, payment_id)
);
CREATE INDEX IF NOT EXISTS idx_btl_bank_txn ON bank_txn_links(bank_txn_id);
CREATE INDEX IF NOT EXISTS idx_btl_payment  ON bank_txn_links(payment_id);

-- Credits that are not customer receipts (loan, capital introduced, refund, interest...) can be
-- dismissed so they stop showing up as "needs linking".
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS link_dismissed boolean DEFAULT false;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS link_note text;

-- Rows held for linking at import (see migrations/003_bank_pending_link.sql)
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS pending_link boolean DEFAULT false;
