-- ═══════════════════════════════════════════════════════════════════════════
-- Link the Needle Point operations app (public schema: brands, products,
-- shipments, employees, work_logs) with the accounts app (accounts_erp schema).
--
-- Run ONCE, in the Supabase project that holds BOTH apps (see MERGE_GUIDE.md),
-- after accounts_erp schema.sql + migrations 001–005. Safe to re-run.
--
-- What it sets up
--   • brands get billing fields (GSTIN, state, address, email, PAN)
--   • every brand is mirrored as a client party, every employee as an
--     employee party, in the business you mark as the operations business
--   • invoices / challans / invoice lines remember which production order
--     and garment they came from; dispatches remember their invoice/challan
--   • salary expenses remember the employee + month (no double posting)
--   • two read-only views the operations app uses to show billing status
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Which accounts business is the operations business ─────────────────
CREATE TABLE IF NOT EXISTS accounts_erp.integration_settings (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ops_business_id uuid REFERENCES accounts_erp.businesses(id) ON DELETE SET NULL,
  updated_at      timestamptz DEFAULT now()
);
INSERT INTO accounts_erp.integration_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE accounts_erp.integration_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "integration_settings_all" ON accounts_erp.integration_settings;
CREATE POLICY "integration_settings_all" ON accounts_erp.integration_settings FOR ALL USING (true) WITH CHECK (true);

-- ── 2. Billing details on brands ─────────────────────────────────────────
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS gstin text;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS pan text;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS payment_terms_days int;

-- ── 3. Link columns ──────────────────────────────────────────────────────
ALTER TABLE accounts_erp.parties ADD COLUMN IF NOT EXISTS brand_id    uuid REFERENCES public.brands(id)    ON DELETE SET NULL;
ALTER TABLE accounts_erp.parties ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_parties_brand    ON accounts_erp.parties(business_id, brand_id)    WHERE brand_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_parties_employee ON accounts_erp.parties(business_id, employee_id) WHERE employee_id IS NOT NULL;

-- ops_order_key identifies a production order: 'PO:<brand id>|<PO NUMBER>' for
-- garments sharing a PO number, or 'P:<product id>' for a garment without one.
-- Same rule as accounts_erp.ops_order_key() below and src/lib/opsLink.js.
ALTER TABLE accounts_erp.invoices          ADD COLUMN IF NOT EXISTS ops_order_key text;
ALTER TABLE accounts_erp.invoices          ADD COLUMN IF NOT EXISTS po_number     text;
ALTER TABLE accounts_erp.delivery_challans ADD COLUMN IF NOT EXISTS ops_order_key text;
ALTER TABLE accounts_erp.delivery_challans ADD COLUMN IF NOT EXISTS po_number     text;
ALTER TABLE accounts_erp.invoice_items     ADD COLUMN IF NOT EXISTS ops_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_ops_order  ON accounts_erp.invoices(ops_order_key)          WHERE ops_order_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_challans_ops_order  ON accounts_erp.delivery_challans(ops_order_key) WHERE ops_order_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_items_ops_prod  ON accounts_erp.invoice_items(ops_product_id)    WHERE ops_product_id IS NOT NULL;

ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES accounts_erp.invoices(id)          ON DELETE SET NULL;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS challan_id uuid REFERENCES accounts_erp.delivery_challans(id) ON DELETE SET NULL;

ALTER TABLE accounts_erp.expenses ADD COLUMN IF NOT EXISTS employee_id   uuid REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE accounts_erp.expenses ADD COLUMN IF NOT EXISTS payroll_month text;   -- 'YYYY-MM'
CREATE UNIQUE INDEX IF NOT EXISTS uidx_expenses_payroll ON accounts_erp.expenses(employee_id, payroll_month) WHERE payroll_month IS NOT NULL;

-- ── 4. Order key helper ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accounts_erp.ops_order_key(p_brand uuid, p_po text, p_product uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN nullif(trim(coalesce(p_po, '')), '') IS NOT NULL
              THEN 'PO:' || coalesce(p_brand::text, 'none') || '|' || upper(trim(p_po))
              ELSE 'P:' || p_product::text END
$$;

-- ── 5. Brand ⇄ party and employee → party sync ───────────────────────────
-- Brands are the master for name; billing fields flow both ways, so fixing a
-- GSTIN in either app updates the other. pg_trigger_depth() stops the two
-- triggers bouncing off each other.
CREATE OR REPLACE FUNCTION accounts_erp.sync_brand_to_party() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, public AS $$
DECLARE biz uuid; pid uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  SELECT ops_business_id INTO biz FROM accounts_erp.integration_settings WHERE id = 1;
  IF biz IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO pid FROM accounts_erp.parties WHERE business_id = biz AND brand_id = NEW.id;
  IF pid IS NULL THEN   -- adopt an existing client with the same name instead of duplicating it
    SELECT id INTO pid FROM accounts_erp.parties
     WHERE business_id = biz AND brand_id IS NULL AND type = 'client' AND lower(trim(name)) = lower(trim(NEW.name)) LIMIT 1;
    IF pid IS NOT NULL THEN
      UPDATE accounts_erp.parties SET brand_id = NEW.id WHERE id = pid;
      -- fill the brand's blank billing fields from the party you already had
      UPDATE public.brands b SET
        gstin           = coalesce(nullif(b.gstin, ''), p.gstin),
        state           = coalesce(nullif(b.state, ''), p.state),
        billing_address = coalesce(nullif(b.billing_address, ''), p.address),
        email           = coalesce(nullif(b.email, ''), p.email),
        pan             = coalesce(nullif(b.pan, ''), p.pan),
        contact_phone   = coalesce(nullif(b.contact_phone, ''), p.phone)
      FROM accounts_erp.parties p WHERE p.id = pid AND b.id = NEW.id;
    END IF;
  END IF;
  IF pid IS NULL THEN
    INSERT INTO accounts_erp.parties (business_id, brand_id, name, type, phone, email, gstin, state, address, pan)
    VALUES (biz, NEW.id, NEW.name, 'client', NEW.contact_phone, NEW.email, nullif(NEW.gstin, ''), nullif(NEW.state, ''), nullif(NEW.billing_address, ''), nullif(NEW.pan, ''));
  ELSE
    UPDATE accounts_erp.parties SET
      name    = NEW.name,
      phone   = coalesce(nullif(NEW.contact_phone, ''), phone),
      email   = coalesce(nullif(NEW.email, ''), email),
      gstin   = coalesce(nullif(NEW.gstin, ''), gstin),
      state   = coalesce(nullif(NEW.state, ''), state),
      address = coalesce(nullif(NEW.billing_address, ''), address),
      pan     = coalesce(nullif(NEW.pan, ''), pan)
    WHERE id = pid;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_brand_to_party ON public.brands;
CREATE TRIGGER trg_brand_to_party AFTER INSERT OR UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION accounts_erp.sync_brand_to_party();

CREATE OR REPLACE FUNCTION accounts_erp.sync_party_to_brand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, public AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.brand_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.brands SET
    gstin           = coalesce(nullif(NEW.gstin, ''), gstin),
    state           = coalesce(nullif(NEW.state, ''), state),
    billing_address = coalesce(nullif(NEW.address, ''), billing_address),
    email           = coalesce(nullif(NEW.email, ''), email),
    pan             = coalesce(nullif(NEW.pan, ''), pan),
    contact_phone   = coalesce(nullif(NEW.phone, ''), contact_phone)
  WHERE id = NEW.brand_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_party_to_brand ON accounts_erp.parties;
CREATE TRIGGER trg_party_to_brand AFTER UPDATE ON accounts_erp.parties
  FOR EACH ROW EXECUTE FUNCTION accounts_erp.sync_party_to_brand();

CREATE OR REPLACE FUNCTION accounts_erp.sync_employee_to_party() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, public AS $$
DECLARE biz uuid; pid uuid;
BEGIN
  SELECT ops_business_id INTO biz FROM accounts_erp.integration_settings WHERE id = 1;
  IF biz IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO pid FROM accounts_erp.parties WHERE business_id = biz AND employee_id = NEW.id;
  IF pid IS NULL THEN
    SELECT id INTO pid FROM accounts_erp.parties
     WHERE business_id = biz AND employee_id IS NULL AND type = 'employee' AND lower(trim(name)) = lower(trim(NEW.name)) LIMIT 1;
    IF pid IS NOT NULL THEN UPDATE accounts_erp.parties SET employee_id = NEW.id WHERE id = pid; END IF;
  END IF;
  IF pid IS NULL THEN
    INSERT INTO accounts_erp.parties (business_id, employee_id, name, type, phone)
    VALUES (biz, NEW.id, NEW.name, 'employee', NEW.phone);
  ELSE
    UPDATE accounts_erp.parties SET name = NEW.name, phone = coalesce(nullif(NEW.phone, ''), phone) WHERE id = pid;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_employee_to_party ON public.employees;
CREATE TRIGGER trg_employee_to_party AFTER INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION accounts_erp.sync_employee_to_party();

-- Called from the accounts app (Production Orders → setup): picks the
-- business and links every existing brand and employee straight away.
CREATE OR REPLACE FUNCTION accounts_erp.set_ops_business(biz uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, public AS $$
DECLARE n int;
BEGIN
  UPDATE accounts_erp.integration_settings SET ops_business_id = biz, updated_at = now() WHERE id = 1;
  UPDATE public.brands SET name = name;       -- fires the sync trigger for every brand
  UPDATE public.employees SET name = name;
  SELECT count(*) INTO n FROM accounts_erp.parties WHERE business_id = biz AND (brand_id IS NOT NULL OR employee_id IS NOT NULL);
  RETURN n;
END $$;

-- ── 6. Views the operations app reads ────────────────────────────────────
-- One row per production order that has any accounting document.
CREATE OR REPLACE VIEW public.order_billing AS
WITH docs AS (
  SELECT i.ops_order_key, i.id, i.status, i.total, i.type
  FROM accounts_erp.invoices i
  WHERE i.ops_order_key IS NOT NULL AND i.status <> 'cancelled' AND i.type = 'sale'
), paid AS (
  SELECT p.invoice_id, sum(p.amount) AS amt FROM accounts_erp.payments p GROUP BY p.invoice_id
)
SELECT d.ops_order_key,
       coalesce(sum(d.total) FILTER (WHERE d.status NOT IN ('proforma', 'draft')), 0) AS invoiced,
       coalesce(sum(d.total) FILTER (WHERE d.status = 'proforma'), 0)                 AS proforma_open,
       coalesce(sum(pd.amt), 0)                                                         AS received,
       count(*) FILTER (WHERE d.status NOT IN ('proforma', 'draft'))                    AS invoice_count,
       bool_or(d.status = 'proforma')                                                   AS has_proforma
FROM docs d LEFT JOIN paid pd ON pd.invoice_id = d.id
GROUP BY d.ops_order_key;

-- Document list per order (shown in the order's detail popup).
CREATE OR REPLACE VIEW public.order_documents AS
SELECT i.ops_order_key, 'invoice'::text AS kind, i.id, i.invoice_number AS number, i.issue_date AS doc_date,
       i.status, i.total, coalesce((SELECT sum(p.amount) FROM accounts_erp.payments p WHERE p.invoice_id = i.id), 0) AS paid
FROM accounts_erp.invoices i WHERE i.ops_order_key IS NOT NULL AND i.type = 'sale'
UNION ALL
SELECT c.ops_order_key, 'challan', c.id, c.challan_number, c.challan_date, c.status, c.total, 0
FROM accounts_erp.delivery_challans c WHERE c.ops_order_key IS NOT NULL;

GRANT SELECT ON public.order_billing, public.order_documents TO anon, authenticated;
GRANT USAGE ON SCHEMA accounts_erp TO anon, authenticated;
GRANT EXECUTE ON FUNCTION accounts_erp.set_ops_business(uuid) TO anon, authenticated;
