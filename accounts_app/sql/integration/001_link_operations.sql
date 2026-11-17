-- ═══════════════════════════════════════════════════════════════════════════
-- Link the Needle Point operations app (schema `ops`) with this accounts app
-- (schema `accounts_erp`). Both live in the same Supabase project.
--
-- Run ONCE in the SQL editor, after the operations app's ops_install.sql.
-- Safe to re-run. Touches only `ops` and `accounts_erp`.
--
-- What it sets up
--   • brands ⇄ client parties: linked, with GSTIN / state / address / PAN /
--     phone / email kept in sync both ways. The party keeps its own name
--     (your legal billing name); the brand keeps its short name.
--   • team members → employee parties (for payroll)
--   • invoices / challans / invoice lines remember which production order and
--     garment they came from; dispatches remember their invoice / challan
--   • salary expenses remember the employee + month (no double posting)
--   • views the operations app reads for billing status and linked parties
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

-- ── 2. Link columns ──────────────────────────────────────────────────────
ALTER TABLE accounts_erp.parties ADD COLUMN IF NOT EXISTS brand_id    uuid REFERENCES ops.brands(id)    ON DELETE SET NULL;
ALTER TABLE accounts_erp.parties ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES ops.employees(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_parties_brand    ON accounts_erp.parties(business_id, brand_id)    WHERE brand_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_parties_employee ON accounts_erp.parties(business_id, employee_id) WHERE employee_id IS NOT NULL;

-- ops_order_key identifies a production order: 'PO:<brand id>|<PO NUMBER>' for
-- garments sharing a PO number, or 'P:<product id>' for a garment without one.
-- Same rule as accounts_erp.ops_order_key() below and src/lib/opsLink.js.
ALTER TABLE accounts_erp.invoices          ADD COLUMN IF NOT EXISTS ops_order_key text;
ALTER TABLE accounts_erp.invoices          ADD COLUMN IF NOT EXISTS po_number     text;
ALTER TABLE accounts_erp.delivery_challans ADD COLUMN IF NOT EXISTS ops_order_key text;
ALTER TABLE accounts_erp.delivery_challans ADD COLUMN IF NOT EXISTS po_number     text;
ALTER TABLE accounts_erp.invoice_items     ADD COLUMN IF NOT EXISTS ops_product_id uuid REFERENCES ops.products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_ops_order  ON accounts_erp.invoices(ops_order_key)          WHERE ops_order_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_challans_ops_order  ON accounts_erp.delivery_challans(ops_order_key) WHERE ops_order_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_items_ops_prod  ON accounts_erp.invoice_items(ops_product_id)    WHERE ops_product_id IS NOT NULL;

ALTER TABLE ops.shipments ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES accounts_erp.invoices(id)          ON DELETE SET NULL;
ALTER TABLE ops.shipments ADD COLUMN IF NOT EXISTS challan_id uuid REFERENCES accounts_erp.delivery_challans(id) ON DELETE SET NULL;

ALTER TABLE accounts_erp.expenses ADD COLUMN IF NOT EXISTS employee_id   uuid REFERENCES ops.employees(id) ON DELETE SET NULL;
ALTER TABLE accounts_erp.expenses ADD COLUMN IF NOT EXISTS payroll_month text;   -- 'YYYY-MM'
CREATE UNIQUE INDEX IF NOT EXISTS uidx_expenses_payroll ON accounts_erp.expenses(employee_id, payroll_month) WHERE payroll_month IS NOT NULL;

-- ── 3. Helpers ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accounts_erp.ops_order_key(p_brand uuid, p_po text, p_product uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN nullif(trim(coalesce(p_po, '')), '') IS NOT NULL
              THEN 'PO:' || coalesce(p_brand::text, 'none') || '|' || upper(trim(p_po))
              ELSE 'P:' || p_product::text END
$$;

-- "Cayani Apparel Pvt. Ltd." and "cayani apparel" compare equal.
CREATE OR REPLACE FUNCTION accounts_erp.norm_name(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(lower(coalesce(t, '')),
             '\m(pvt|private|ltd|limited|llp|inc|co|company|the|and|india|opc)\M', ' ', 'g'),
           '[^a-z0-9]', '', 'g')
$$;

-- Who may change links: the ops admin / owner once the lockdown is on;
-- anyone using the apps before it (everything is open then anyway).
CREATE OR REPLACE FUNCTION accounts_erp.can_manage_links() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
  SELECT ops.ops_is_admin() OR NOT ops.ops_locked()
$$;

-- An existing client party that is clearly the same as this brand: same GSTIN,
-- or the same name once "Pvt Ltd", punctuation etc. are ignored.
CREATE OR REPLACE FUNCTION accounts_erp.sure_party_for_brand(biz uuid, b ops.brands) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM accounts_erp.parties
   WHERE business_id = biz AND brand_id IS NULL AND type = 'client'
     AND ((nullif(b.gstin, '') IS NOT NULL AND upper(gstin) = upper(b.gstin))
          OR (accounts_erp.norm_name(name) <> '' AND accounts_erp.norm_name(name) = accounts_erp.norm_name(b.name)))
   ORDER BY (nullif(b.gstin, '') IS NOT NULL AND upper(gstin) = upper(b.gstin)) DESC, created_at
   LIMIT 1
$$;

-- Copy billing details between a linked brand and party: blanks are filled
-- from the other side, never overwritten.
CREATE OR REPLACE FUNCTION accounts_erp.fill_link_blanks(p_party uuid, p_brand uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
BEGIN
  UPDATE ops.brands b SET
    gstin           = coalesce(nullif(b.gstin, ''), p.gstin),
    state           = coalesce(nullif(b.state, ''), p.state),
    billing_address = coalesce(nullif(b.billing_address, ''), p.address),
    email           = coalesce(nullif(b.email, ''), p.email),
    pan             = coalesce(nullif(b.pan, ''), p.pan),
    contact_phone   = coalesce(nullif(b.contact_phone, ''), p.phone)
  FROM accounts_erp.parties p WHERE p.id = p_party AND b.id = p_brand;
  UPDATE accounts_erp.parties p SET
    gstin   = coalesce(nullif(p.gstin, ''), nullif(b.gstin, '')),
    state   = coalesce(nullif(p.state, ''), nullif(b.state, '')),
    address = coalesce(nullif(p.address, ''), nullif(b.billing_address, '')),
    email   = coalesce(nullif(p.email, ''), nullif(b.email, '')),
    pan     = coalesce(nullif(p.pan, ''), nullif(b.pan, '')),
    phone   = coalesce(nullif(p.phone, ''), nullif(b.contact_phone, ''))
  FROM ops.brands b WHERE p.id = p_party AND b.id = p_brand;
END $$;

-- When a link is moved or removed, take back the details the brand only had
-- because of the old party, so they don't leak into the next party.
CREATE OR REPLACE FUNCTION accounts_erp.clear_copied(p_brand uuid, p_old_party uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
BEGIN
  PERFORM set_config('np.no_sync', '1', true);
  UPDATE ops.brands b SET
    gstin           = CASE WHEN b.gstin = p.gstin THEN NULL ELSE b.gstin END,
    state           = CASE WHEN b.state = p.state THEN NULL ELSE b.state END,
    billing_address = CASE WHEN b.billing_address = p.address THEN NULL ELSE b.billing_address END,
    email           = CASE WHEN b.email = p.email THEN NULL ELSE b.email END,
    pan             = CASE WHEN b.pan = p.pan THEN NULL ELSE b.pan END
  FROM accounts_erp.parties p WHERE p.id = p_old_party AND b.id = p_brand;
  PERFORM set_config('np.no_sync', '', true);
END $$;

-- ── 4. Brand ⇄ party sync ────────────────────────────────────────────────
-- New brand  → linked to the sure-match party, or a new client party is made.
-- Edited brand → its linked party gets the new billing details. An unlinked
-- brand is only linked when there's a sure match; otherwise it waits for you
-- in Accounts → Parties → Brand links (no duplicate parties).
-- pg_trigger_depth() stops the two triggers bouncing off each other.
CREATE OR REPLACE FUNCTION accounts_erp.sync_brand_to_party() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
DECLARE biz uuid; pid uuid; forced text;
BEGIN
  IF pg_trigger_depth() > 1 OR current_setting('np.no_sync', true) = '1' THEN RETURN NEW; END IF;
  SELECT ops_business_id INTO biz FROM accounts_erp.integration_settings WHERE id = 1;
  IF biz IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO pid FROM accounts_erp.parties WHERE business_id = biz AND brand_id = NEW.id;
  IF pid IS NULL THEN
    forced := nullif(current_setting('np.link_party', true), '');   -- set by create_brand_from_party
    pid := coalesce(forced::uuid, accounts_erp.sure_party_for_brand(biz, NEW));
    IF pid IS NOT NULL THEN
      UPDATE accounts_erp.parties SET brand_id = NEW.id WHERE id = pid;
      PERFORM accounts_erp.fill_link_blanks(pid, NEW.id);
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
      INSERT INTO accounts_erp.parties (business_id, brand_id, name, type, phone, email, gstin, state, address, pan)
      VALUES (biz, NEW.id, NEW.name, 'client', NEW.contact_phone, NEW.email, nullif(NEW.gstin, ''), nullif(NEW.state, ''), nullif(NEW.billing_address, ''), nullif(NEW.pan, ''));
    END IF;
    RETURN NEW;
  END IF;
  UPDATE accounts_erp.parties SET
    phone   = coalesce(nullif(NEW.contact_phone, ''), phone),
    email   = coalesce(nullif(NEW.email, ''), email),
    gstin   = coalesce(nullif(NEW.gstin, ''), gstin),
    state   = coalesce(nullif(NEW.state, ''), state),
    address = coalesce(nullif(NEW.billing_address, ''), address),
    pan     = coalesce(nullif(NEW.pan, ''), pan)
  WHERE id = pid;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_brand_to_party ON ops.brands;
CREATE TRIGGER trg_brand_to_party AFTER INSERT OR UPDATE ON ops.brands
  FOR EACH ROW EXECUTE FUNCTION accounts_erp.sync_brand_to_party();

CREATE OR REPLACE FUNCTION accounts_erp.sync_party_to_brand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.brand_id IS NULL THEN RETURN NEW; END IF;
  UPDATE ops.brands SET
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

-- ── 5. Team member → employee party ──────────────────────────────────────
CREATE OR REPLACE FUNCTION accounts_erp.sync_employee_to_party() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
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
DROP TRIGGER IF EXISTS trg_employee_to_party ON ops.employees;
CREATE TRIGGER trg_employee_to_party AFTER INSERT OR UPDATE ON ops.employees
  FOR EACH ROW EXECUTE FUNCTION accounts_erp.sync_employee_to_party();

-- ── 6. Actions the apps call ─────────────────────────────────────────────
-- One-time setup (Accounts → Production Orders): picks the business, links
-- every brand that has a sure match and every team member. Returns
-- {linked, to_review}. Brands left to review show in Parties → Brand links.
DROP FUNCTION IF EXISTS accounts_erp.set_ops_business(uuid);
CREATE OR REPLACE FUNCTION accounts_erp.set_ops_business(biz uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
DECLARE linked int; review int;
BEGIN
  IF NOT accounts_erp.can_manage_links() THEN RAISE EXCEPTION 'Only the admin can do this' USING errcode = 'P0001'; END IF;
  UPDATE accounts_erp.integration_settings SET ops_business_id = biz, updated_at = now() WHERE id = 1;
  UPDATE ops.brands SET name = name;          -- links sure matches (never creates parties on update)
  UPDATE ops.employees SET name = name;
  SELECT count(*) INTO linked FROM accounts_erp.parties WHERE business_id = biz AND brand_id IS NOT NULL;
  SELECT count(*) INTO review FROM ops.brands b
   WHERE NOT EXISTS (SELECT 1 FROM accounts_erp.parties p WHERE p.business_id = biz AND p.brand_id = b.id);
  RETURN json_build_object('linked', linked, 'to_review', review);
END $$;

-- Link a brand to a party (or move the link). Fills blanks both ways.
CREATE OR REPLACE FUNCTION accounts_erp.link_brand_party(p_brand uuid, p_party uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
DECLARE biz uuid; old uuid;
BEGIN
  IF NOT accounts_erp.can_manage_links() THEN RAISE EXCEPTION 'Only the admin can change links' USING errcode = 'P0001'; END IF;
  SELECT ops_business_id INTO biz FROM accounts_erp.integration_settings WHERE id = 1;
  SELECT id INTO old FROM accounts_erp.parties WHERE business_id = biz AND brand_id = p_brand;
  IF old = p_party THEN RETURN; END IF;
  IF old IS NOT NULL THEN PERFORM accounts_erp.clear_copied(p_brand, old); END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts_erp.parties WHERE id = p_party AND business_id = biz AND type = 'client') THEN
    RAISE EXCEPTION 'That party is not a client of the operations business' USING errcode = 'P0001';
  END IF;
  UPDATE accounts_erp.parties SET brand_id = NULL WHERE business_id = biz AND brand_id = p_brand AND id <> p_party;
  UPDATE accounts_erp.parties SET brand_id = p_brand WHERE id = p_party;
  PERFORM accounts_erp.fill_link_blanks(p_party, p_brand);
END $$;

-- Brand → new client party (for a brand with no party yet).
CREATE OR REPLACE FUNCTION accounts_erp.create_party_for_brand(p_brand uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
DECLARE biz uuid; b ops.brands; pid uuid;
BEGIN
  IF NOT accounts_erp.can_manage_links() THEN RAISE EXCEPTION 'Only the admin can change links' USING errcode = 'P0001'; END IF;
  SELECT ops_business_id INTO biz FROM accounts_erp.integration_settings WHERE id = 1;
  SELECT * INTO b FROM ops.brands WHERE id = p_brand;
  SELECT id INTO pid FROM accounts_erp.parties WHERE business_id = biz AND brand_id = p_brand;
  IF pid IS NOT NULL THEN RETURN pid; END IF;
  INSERT INTO accounts_erp.parties (business_id, brand_id, name, type, phone, email, gstin, state, address, pan)
  VALUES (biz, b.id, b.name, 'client', b.contact_phone, b.email, nullif(b.gstin, ''), nullif(b.state, ''), nullif(b.billing_address, ''), nullif(b.pan, ''))
  RETURNING id INTO pid;
  RETURN pid;
END $$;

-- Client party → new brand in the operations app (for a client you bill but
-- who isn't set up for production yet). Returns the new brand id.
CREATE OR REPLACE FUNCTION accounts_erp.create_brand_from_party(p_party uuid, p_brand_name text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
DECLARE p accounts_erp.parties; bid uuid;
BEGIN
  IF NOT accounts_erp.can_manage_links() THEN RAISE EXCEPTION 'Only the admin can change links' USING errcode = 'P0001'; END IF;
  SELECT * INTO p FROM accounts_erp.parties WHERE id = p_party;
  IF p.id IS NULL OR p.type <> 'client' THEN RAISE EXCEPTION 'Pick a client party' USING errcode = 'P0001'; END IF;
  IF p.brand_id IS NOT NULL THEN RETURN p.brand_id; END IF;
  PERFORM set_config('np.link_party', p_party::text, true);
  INSERT INTO ops.brands (name, contact_phone, email, gstin, state, billing_address, pan)
  VALUES (coalesce(nullif(trim(p_brand_name), ''), p.name), p.phone, p.email, p.gstin, p.state, p.address, p.pan)
  RETURNING id INTO bid;
  PERFORM set_config('np.link_party', '', true);
  RETURN bid;
END $$;

-- Remove a link (the brand then waits in Brand links until you link it again).
CREATE OR REPLACE FUNCTION accounts_erp.unlink_brand(p_brand uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, ops AS $$
BEGIN
  IF NOT accounts_erp.can_manage_links() THEN RAISE EXCEPTION 'Only the admin can change links' USING errcode = 'P0001'; END IF;
  PERFORM accounts_erp.clear_copied(p_brand, id) FROM accounts_erp.parties WHERE brand_id = p_brand;
  UPDATE accounts_erp.parties SET brand_id = NULL WHERE brand_id = p_brand;
END $$;

GRANT EXECUTE ON FUNCTION accounts_erp.set_ops_business(uuid), accounts_erp.link_brand_party(uuid, uuid),
  accounts_erp.create_party_for_brand(uuid), accounts_erp.create_brand_from_party(uuid, text),
  accounts_erp.unlink_brand(uuid), accounts_erp.can_manage_links() TO anon, authenticated;

-- Client parties of the operations business, for the operations app's Brands
-- screen (shows "Billed as …" and lets the admin import a client as a brand).
-- Logged-in ops staff only once the lockdown is on.
CREATE OR REPLACE VIEW ops.billing_parties AS
SELECT p.id, p.name, p.gstin, p.state, p.phone, p.email, p.address, p.pan, p.brand_id
FROM accounts_erp.parties p
JOIN accounts_erp.integration_settings s ON s.id = 1 AND s.ops_business_id = p.business_id
WHERE p.type = 'client' AND (ops.ops_is_staff() OR NOT ops.ops_locked());
GRANT SELECT ON ops.billing_parties TO anon, authenticated;

-- ── 6. Views the operations app reads ────────────────────────────────────
-- One row per production order that has any accounting document.
CREATE OR REPLACE VIEW ops.order_billing AS
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
CREATE OR REPLACE VIEW ops.order_documents AS
SELECT i.ops_order_key, 'invoice'::text AS kind, i.id, i.invoice_number AS number, i.issue_date AS doc_date,
       i.status, i.total, coalesce((SELECT sum(p.amount) FROM accounts_erp.payments p WHERE p.invoice_id = i.id), 0) AS paid
FROM accounts_erp.invoices i WHERE i.ops_order_key IS NOT NULL AND i.type = 'sale'
UNION ALL
SELECT c.ops_order_key, 'challan', c.id, c.challan_number, c.challan_date, c.status, c.total, 0
FROM accounts_erp.delivery_challans c WHERE c.ops_order_key IS NOT NULL;

GRANT SELECT ON ops.order_billing, ops.order_documents TO anon, authenticated;
GRANT USAGE ON SCHEMA accounts_erp TO anon, authenticated;
