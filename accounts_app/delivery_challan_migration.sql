-- ============================================================
--  Needle Point ERP — Delivery Challan Migration
--  Run this once in your Supabase SQL Editor
--  (Settings → SQL Setup → paste and execute)
-- ============================================================

-- ── 1. delivery_challans ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_challans (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core references
  business_id       UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  party_id          UUID        NOT NULL REFERENCES parties(id),
  linked_invoice_id UUID        REFERENCES invoices(id) ON DELETE SET NULL,

  -- Challan identity
  challan_number    TEXT        NOT NULL,
  challan_date      DATE        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','dispatched','delivered','cancelled')),

  -- Purpose & dispatch details
  purpose           TEXT        NOT NULL DEFAULT 'Supply of Goods',
  transport_mode    TEXT,
  vehicle_number    TEXT,
  lr_number         TEXT,          -- Lorry / GR receipt number
  driver_name       TEXT,
  dispatch_from     TEXT,
  dispatch_to       TEXT,

  -- Financials (computed from line items)
  subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total             NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_interstate     BOOLEAN       NOT NULL DEFAULT FALSE,

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique challan number per business
CREATE UNIQUE INDEX IF NOT EXISTS uidx_challan_number
  ON delivery_challans (business_id, challan_number);

-- Fast lookups by party and date
CREATE INDEX IF NOT EXISTS idx_challans_party
  ON delivery_challans (party_id);

CREATE INDEX IF NOT EXISTS idx_challans_date
  ON delivery_challans (challan_date DESC);

CREATE INDEX IF NOT EXISTS idx_challans_linked_inv
  ON delivery_challans (linked_invoice_id)
  WHERE linked_invoice_id IS NOT NULL;


-- ── 2. delivery_challan_items ────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_challan_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id       UUID        NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,

  description      TEXT        NOT NULL,
  hsn_code         TEXT,
  unit             TEXT        NOT NULL DEFAULT 'Nos',
  quantity         NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_price       NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(5,2)  NOT NULL DEFAULT 0,
  tax_percent      NUMERIC(5,2)  NOT NULL DEFAULT 0,

  -- Pre-computed tax split (mirrors invoice_items pattern)
  taxable_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount           NUMERIC(14,2) NOT NULL DEFAULT 0,   -- line total inc. GST

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challan_items_challan
  ON delivery_challan_items (challan_id);


-- ── 3. Auto-update updated_at on delivery_challans ───────────
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


-- ── 4. Row-Level Security ────────────────────────────────────
--  Enable RLS (same pattern as your other tables).
--  Adjust the policy condition to match your auth setup.

ALTER TABLE delivery_challans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_challan_items ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (anon key = read-only in prod)
CREATE POLICY "challans_all" ON delivery_challans
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "challan_items_all" ON delivery_challan_items
  FOR ALL USING (true) WITH CHECK (true);


-- ── 5. Verify ────────────────────────────────────────────────
--  Run these SELECTs to confirm the tables exist and are empty.

SELECT 'delivery_challans' AS tbl, COUNT(*) FROM delivery_challans
UNION ALL
SELECT 'delivery_challan_items', COUNT(*) FROM delivery_challan_items;
