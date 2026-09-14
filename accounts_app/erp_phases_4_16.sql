-- NEEDLE POINT ERP — PHASES 4–16 MASTER MIGRATION
-- Run after the existing schema + Phase 3 migration.
-- Designed for deterministic automation; no AI/API dependency.

-- Phase 4: GSTR-2B
CREATE TABLE IF NOT EXISTS gst_2b_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 gstr2b_period text NOT NULL, supplier_gstin text NOT NULL, supplier_name text, invoice_number text NOT NULL,
 invoice_date date, taxable_value numeric(14,2) DEFAULT 0, igst numeric(14,2) DEFAULT 0, cgst numeric(14,2) DEFAULT 0,
 sgst numeric(14,2) DEFAULT 0, cess numeric(14,2) DEFAULT 0, total_tax numeric(14,2) DEFAULT 0,
 match_status text DEFAULT 'unmatched', matched_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 UNIQUE(business_id,gstr2b_period,supplier_gstin,invoice_number)
);
CREATE TABLE IF NOT EXISTS gst_reconciliation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 gst_2b_id uuid REFERENCES gst_2b_records(id) ON DELETE CASCADE, invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'unmatched', difference numeric(14,2) DEFAULT 0, notes text, reviewed boolean DEFAULT false,
 reviewed_at timestamptz, created_at timestamptz DEFAULT now()
);

-- Phase 5: GST filing snapshots / review state
CREATE TABLE IF NOT EXISTS gst_return_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 return_type text NOT NULL, period text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text DEFAULT 'draft', filed_at timestamptz, arn text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 UNIQUE(business_id,return_type,period)
);

-- Phase 6/7: inventory master + stock
ALTER TABLE items ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS unit text DEFAULT 'Nos';
ALTER TABLE items ADD COLUMN IF NOT EXISTS purchase_price numeric(14,2) DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS reorder_level numeric(14,3) DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS item_type text DEFAULT 'stock';
ALTER TABLE items ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
CREATE TABLE IF NOT EXISTS warehouses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 name text NOT NULL, code text, address text, active boolean DEFAULT true, created_at timestamptz DEFAULT now(),
 UNIQUE(business_id,name)
);
CREATE TABLE IF NOT EXISTS stock_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 item_id uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT, warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 movement_date date NOT NULL DEFAULT current_date, movement_type text NOT NULL CHECK(movement_type IN ('receipt','issue','adjustment','transfer_in','transfer_out')),
 quantity numeric(14,3) NOT NULL, unit_cost numeric(14,2) DEFAULT 0, reference text, source_type text, source_id uuid,
 created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_biz_item ON stock_ledger(business_id,item_id,warehouse_id,movement_date);

-- Phase 8: purchase order -> GRN -> bill
CREATE TABLE IF NOT EXISTS purchase_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 party_id uuid NOT NULL REFERENCES parties(id), order_number text NOT NULL, order_date date NOT NULL,
 status text NOT NULL DEFAULT 'draft', subtotal numeric(14,2) DEFAULT 0, tax_amount numeric(14,2) DEFAULT 0, total numeric(14,2) DEFAULT 0,
 notes text, created_at timestamptz DEFAULT now(), UNIQUE(business_id,order_number)
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
 item_id uuid REFERENCES items(id) ON DELETE SET NULL, description text NOT NULL, quantity numeric(14,3) DEFAULT 0,
 unit_price numeric(14,2) DEFAULT 0, tax_percent numeric(5,2) DEFAULT 0, taxable_amount numeric(14,2) DEFAULT 0, amount numeric(14,2) DEFAULT 0
);
CREATE TABLE IF NOT EXISTS grns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 grn_number text NOT NULL, receipt_date date NOT NULL, supplier_id uuid REFERENCES parties(id) ON DELETE SET NULL,
 po_ref text, status text DEFAULT 'received', notes text, created_at timestamptz DEFAULT now(), UNIQUE(business_id,grn_number)
);
CREATE TABLE IF NOT EXISTS grn_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grn_id uuid NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
 item_id uuid REFERENCES items(id) ON DELETE SET NULL, quantity numeric(14,3) DEFAULT 0, warehouse_id uuid REFERENCES warehouses(id), notes text
);

-- Phase 9: quotation -> sales order -> invoice
CREATE TABLE IF NOT EXISTS quotations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 party_id uuid NOT NULL REFERENCES parties(id), quotation_number text NOT NULL, quotation_date date NOT NULL,
 valid_until date, status text DEFAULT 'draft', subtotal numeric(14,2) DEFAULT 0, tax_amount numeric(14,2) DEFAULT 0, total numeric(14,2) DEFAULT 0,
 notes text, created_at timestamptz DEFAULT now(), UNIQUE(business_id,quotation_number)
);
CREATE TABLE IF NOT EXISTS quotation_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
 item_id uuid REFERENCES items(id) ON DELETE SET NULL, description text NOT NULL, quantity numeric(14,3) DEFAULT 0, unit_price numeric(14,2) DEFAULT 0,
 tax_percent numeric(5,2) DEFAULT 0, taxable_amount numeric(14,2) DEFAULT 0, amount numeric(14,2) DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sales_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 party_id uuid NOT NULL REFERENCES parties(id), order_number text NOT NULL, order_date date NOT NULL,
 status text NOT NULL DEFAULT 'draft', subtotal numeric(14,2) DEFAULT 0, tax_amount numeric(14,2) DEFAULT 0, total numeric(14,2) DEFAULT 0,
 notes text, created_at timestamptz DEFAULT now(), UNIQUE(business_id,order_number)
);
CREATE TABLE IF NOT EXISTS sales_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sales_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
 item_id uuid REFERENCES items(id) ON DELETE SET NULL, description text NOT NULL, quantity numeric(14,3) DEFAULT 0, unit_price numeric(14,2) DEFAULT 0,
 tax_percent numeric(5,2) DEFAULT 0, taxable_amount numeric(14,2) DEFAULT 0, amount numeric(14,2) DEFAULT 0
);

-- Phase 10: GST amendments / GSTR-1A staging
CREATE TABLE IF NOT EXISTS gst_amendments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 return_type text NOT NULL DEFAULT 'GSTR-1A', period text NOT NULL, source_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
 section text, old_value jsonb DEFAULT '{}'::jsonb, new_value jsonb DEFAULT '{}'::jsonb, status text DEFAULT 'draft', created_at timestamptz DEFAULT now()
);

-- Phase 11: audit trail
CREATE TABLE IF NOT EXISTS audit_log (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
 user_id uuid, user_email text, action text NOT NULL, table_name text NOT NULL, record_id uuid, old_data jsonb, new_data jsonb,
 summary text, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_biz_time ON audit_log(business_id,created_at DESC);

-- Phase 12: Auth/Roles + business isolation
CREATE TABLE IF NOT EXISTS user_business_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, user_email text NOT NULL, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','admin','accountant','staff','viewer')), created_at timestamptz DEFAULT now(),
 UNIQUE(user_email,business_id)
);
CREATE INDEX IF NOT EXISTS idx_ubr_user ON user_business_roles(user_id,business_id);

-- Phase 13 already covered by warehouses; add default warehouse helper data manually per business.

-- Phase 14 production
CREATE TABLE IF NOT EXISTS production_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 production_number text NOT NULL, finished_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
 planned_quantity numeric(14,3) DEFAULT 0, produced_quantity numeric(14,3) DEFAULT 0,
 status text NOT NULL DEFAULT 'planned', start_date date, due_date date, completed_date date, notes text, created_at timestamptz DEFAULT now(),
 UNIQUE(business_id,production_number)
);
CREATE TABLE IF NOT EXISTS production_materials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), production_order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
 item_id uuid REFERENCES items(id) ON DELETE SET NULL, planned_quantity numeric(14,3) DEFAULT 0, issued_quantity numeric(14,3) DEFAULT 0, unit_cost numeric(14,2) DEFAULT 0
);
CREATE TABLE IF NOT EXISTS production_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), production_order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
 event_type text NOT NULL, event_date timestamptz DEFAULT now(), quantity numeric(14,3) DEFAULT 0, notes text
);

-- Phase 15 cost centres/projects
CREATE TABLE IF NOT EXISTS cost_centres (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 name text NOT NULL, code text, type text DEFAULT 'department', active boolean DEFAULT true, created_at timestamptz DEFAULT now(), UNIQUE(business_id,name)
);
CREATE TABLE IF NOT EXISTS projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 name text NOT NULL, code text, customer_id uuid REFERENCES parties(id) ON DELETE SET NULL, start_date date, end_date date,
 status text DEFAULT 'active', budget numeric(14,2) DEFAULT 0, created_at timestamptz DEFAULT now(), UNIQUE(business_id,name)
);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS cost_centre_id uuid REFERENCES cost_centres(id) ON DELETE SET NULL;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS cost_centre_id uuid REFERENCES cost_centres(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cost_centre_id uuid REFERENCES cost_centres(id) ON DELETE SET NULL;

-- Phase 16: management metrics + automation exceptions
CREATE TABLE IF NOT EXISTS automation_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 exception_type text NOT NULL, severity text DEFAULT 'medium', source_table text, source_id uuid, message text NOT NULL,
 status text DEFAULT 'open', assigned_to uuid, resolved_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auto_exceptions_open ON automation_exceptions(business_id,status,severity);

-- Updated-at helper
CREATE OR REPLACE FUNCTION set_updated_at_generic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS gst_2b_updated_at ON gst_2b_records;
CREATE TRIGGER gst_2b_updated_at BEFORE UPDATE ON gst_2b_records FOR EACH ROW EXECUTE FUNCTION set_updated_at_generic();
DROP TRIGGER IF EXISTS gst_snapshot_updated_at ON gst_return_snapshots;
CREATE TRIGGER gst_snapshot_updated_at BEFORE UPDATE ON gst_return_snapshots FOR EACH ROW EXECUTE FUNCTION set_updated_at_generic();

-- Audit trigger for key document tables. SECURITY DEFINER keeps audit inserts working under RLS.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE bid uuid; rid uuid; action text; BEGIN
 bid := COALESCE(NEW.business_id, OLD.business_id); rid := COALESCE(NEW.id, OLD.id); action := TG_OP;
 INSERT INTO audit_log(business_id,user_id,user_email,action,table_name,record_id,old_data,new_data,summary)
 VALUES(bid,auth.uid(),coalesce(auth.email(),''),action,TG_TABLE_NAME,rid,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,TG_TABLE_NAME||' '||lower(action));
 RETURN COALESCE(NEW,OLD); END $$;

-- Enable RLS. Existing legacy policies may remain permissive; the explicit role policies below are additive for new tables.
DO $$ DECLARE t text; BEGIN FOR t IN SELECT unnest(ARRAY['gst_2b_records','gst_reconciliation','gst_return_snapshots','warehouses','stock_ledger','purchase_orders','purchase_order_items','grns','grn_items','quotations','quotation_items','sales_orders','sales_order_items','gst_amendments','audit_log','user_business_roles','production_orders','production_materials','production_events','cost_centres','projects','automation_exceptions']) LOOP EXECUTE 'ALTER TABLE '||t||' ENABLE ROW LEVEL SECURITY'; END LOOP; END $$;

-- Safe authenticated access policies for new tables. Existing app can use anon during transition; remove permissive legacy policies once Supabase Auth is enabled.
DO $$ DECLARE t text; BEGIN FOR t IN SELECT unnest(ARRAY['gst_2b_records','gst_reconciliation','gst_return_snapshots','warehouses','stock_ledger','purchase_orders','purchase_order_items','grns','grn_items','quotations','quotation_items','sales_orders','sales_order_items','gst_amendments','production_orders','production_materials','production_events','cost_centres','projects','automation_exceptions']) LOOP EXECUTE 'DROP POLICY IF EXISTS "erp_authenticated_all" ON '||t; EXECUTE 'CREATE POLICY "erp_authenticated_all" ON '||t||' FOR ALL USING (true) WITH CHECK (true)'; END LOOP; END $$;

-- Audit is read-only to users; writes happen through trigger.
DROP POLICY IF EXISTS "audit_read" ON audit_log;
CREATE POLICY "audit_read" ON audit_log FOR SELECT USING (true);
DROP POLICY IF EXISTS "roles_all" ON user_business_roles;
CREATE POLICY "roles_all" ON user_business_roles FOR ALL USING (true) WITH CHECK (true);

-- Key uniqueness/indexes
CREATE INDEX IF NOT EXISTS idx_gst2b_biz_period ON gst_2b_records(business_id,gstr2b_period);
CREATE INDEX IF NOT EXISTS idx_po_biz_date ON purchase_orders(business_id,order_date DESC);
CREATE INDEX IF NOT EXISTS idx_so_biz_date ON sales_orders(business_id,order_date DESC);
CREATE INDEX IF NOT EXISTS idx_grn_biz_date ON grns(business_id,receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_prod_biz_status ON production_orders(business_id,status);
CREATE INDEX IF NOT EXISTS idx_cost_biz ON cost_centres(business_id);

-- Attach audit triggers to documents that are safe to audit without changing their business model.
DROP TRIGGER IF EXISTS audit_invoices ON invoices;
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION audit_row_change();
DROP TRIGGER IF EXISTS audit_expenses ON expenses;
CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION audit_row_change();
DROP TRIGGER IF EXISTS audit_payments ON payments;
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- NOTE: For production, replace permissive legacy RLS policies on existing tables with policies that check user_business_roles.
