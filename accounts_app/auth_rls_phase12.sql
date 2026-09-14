-- Needle Point ERP — Phase 12 production RLS / Supabase Auth hardening
-- Run AFTER the core schema and erp_phases_4_16.sql.
-- This replaces the temporary permissive policies on the ERP tables.

CREATE OR REPLACE FUNCTION has_business_access(bid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = accounts_erp, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_business_roles r
    WHERE r.business_id = bid
      AND (r.user_id = auth.uid() OR lower(r.user_email) = lower(coalesce(auth.email(),'')))
  );
$$;

CREATE OR REPLACE FUNCTION has_business_role(bid uuid, allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = accounts_erp, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_business_roles r
    WHERE r.business_id = bid
      AND (r.user_id = auth.uid() OR lower(r.user_email) = lower(coalesce(auth.email(),'')))
      AND r.role = ANY(allowed_roles)
  );
$$;

-- Prevent direct role escalation. Owners/admins may manage memberships.
DROP POLICY IF EXISTS roles_all ON user_business_roles;
CREATE POLICY roles_select ON user_business_roles FOR SELECT USING (has_business_access(business_id));
CREATE POLICY roles_insert ON user_business_roles FOR INSERT WITH CHECK (has_business_role(business_id, ARRAY['owner','admin']));
CREATE POLICY roles_update ON user_business_roles FOR UPDATE USING (has_business_role(business_id, ARRAY['owner','admin'])) WITH CHECK (has_business_role(business_id, ARRAY['owner','admin']));
CREATE POLICY roles_delete ON user_business_roles FOR DELETE USING (has_business_role(business_id, ARRAY['owner','admin']));

-- Tables whose rows carry business_id.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['parties','items','invoices','payments','expenses','accounts','journal_entries','credit_notes','debit_notes','bank_accounts','bank_transactions','delivery_challans','gst_2b_records','gst_reconciliation','gst_return_snapshots','warehouses','stock_ledger','purchase_orders','grns','quotations','sales_orders','gst_amendments','audit_log','production_orders','cost_centres','projects','automation_exceptions'] LOOP
    EXECUTE 'ALTER TABLE '||t||' ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS erp_authenticated_all ON '||t;
    EXECUTE 'DROP POLICY IF EXISTS erp_business_access ON '||t;
    EXECUTE 'CREATE POLICY erp_business_access ON '||t||' FOR ALL USING (has_business_access(business_id)) WITH CHECK (has_business_access(business_id))';
  END LOOP;
END $$;

-- Businesses themselves: a user can see businesses they belong to; owners/admins can modify.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_businesses_all ON businesses;
DROP POLICY IF EXISTS businesses_select ON businesses;
DROP POLICY IF EXISTS businesses_manage ON businesses;
CREATE POLICY businesses_select ON businesses FOR SELECT USING (has_business_access(id));
CREATE POLICY businesses_manage ON businesses FOR ALL USING (has_business_role(id, ARRAY['owner','admin'])) WITH CHECK (has_business_role(id, ARRAY['owner','admin']));

-- Child tables without business_id derive access through their parent.
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_invoice_items_all ON invoice_items;
CREATE POLICY invoice_items_access ON invoice_items FOR ALL
USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id=invoice_id AND has_business_access(i.business_id)))
WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id=invoice_id AND has_business_access(i.business_id)));

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_journal_lines_all ON journal_lines;
CREATE POLICY journal_lines_access ON journal_lines FOR ALL
USING (EXISTS (SELECT 1 FROM journal_entries j WHERE j.id=journal_id AND has_business_access(j.business_id)))
WITH CHECK (EXISTS (SELECT 1 FROM journal_entries j WHERE j.id=journal_id AND has_business_access(j.business_id)));

ALTER TABLE credit_note_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_credit_note_items_all ON credit_note_items;
CREATE POLICY credit_note_items_access ON credit_note_items FOR ALL
USING (EXISTS (SELECT 1 FROM credit_notes n WHERE n.id=credit_note_id AND has_business_access(n.business_id)))
WITH CHECK (EXISTS (SELECT 1 FROM credit_notes n WHERE n.id=credit_note_id AND has_business_access(n.business_id)));

ALTER TABLE debit_note_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_debit_note_items_all ON debit_note_items;
CREATE POLICY debit_note_items_access ON debit_note_items FOR ALL
USING (EXISTS (SELECT 1 FROM debit_notes n WHERE n.id=debit_note_id AND has_business_access(n.business_id)))
WITH CHECK (EXISTS (SELECT 1 FROM debit_notes n WHERE n.id=debit_note_id AND has_business_access(n.business_id)));

ALTER TABLE delivery_challan_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_delivery_challan_items_all ON delivery_challan_items;
CREATE POLICY delivery_challan_items_access ON delivery_challan_items FOR ALL
USING (EXISTS (SELECT 1 FROM delivery_challans d WHERE d.id=challan_id AND has_business_access(d.business_id)))
WITH CHECK (EXISTS (SELECT 1 FROM delivery_challans d WHERE d.id=challan_id AND has_business_access(d.business_id)));

-- Purchase/sales/order child rows.
DO $$ DECLARE spec record; BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('purchase_order_items','purchase_order_id','purchase_orders'),
    ('sales_order_items','sales_order_id','sales_orders'),
    ('quotation_items','quotation_id','quotations'),
    ('grn_items','grn_id','grns'),
    ('production_materials','production_order_id','production_orders'),
    ('production_events','production_order_id','production_orders')
  ) v(child_table,parent_col,parent_table) LOOP
    EXECUTE 'ALTER TABLE '||spec.child_table||' ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS erp_child_access ON '||spec.child_table;
    EXECUTE 'CREATE POLICY erp_child_access ON '||spec.child_table||' FOR ALL USING (EXISTS (SELECT 1 FROM '||spec.parent_table||' p WHERE p.id='||spec.parent_col||' AND has_business_access(p.business_id))) WITH CHECK (EXISTS (SELECT 1 FROM '||spec.parent_table||' p WHERE p.id='||spec.parent_col||' AND has_business_access(p.business_id)))';
  END LOOP;
END $$;

-- Audit records are immutable from the client. Only the audit trigger should insert them.
DROP POLICY IF EXISTS audit_read ON audit_log;
DROP POLICY IF EXISTS audit_insert ON audit_log;
DROP POLICY IF EXISTS audit_update ON audit_log;
DROP POLICY IF EXISTS audit_delete ON audit_log;
CREATE POLICY audit_read ON audit_log FOR SELECT USING (has_business_access(business_id));

REVOKE UPDATE, DELETE ON audit_log FROM anon, authenticated;

-- New authenticated users still need an initial membership. Create the first owner manually
-- after signing up, e.g.:
-- INSERT INTO user_business_roles(user_id,user_email,business_id,role)
-- VALUES ('AUTH-USER-UUID','user@example.com','BUSINESS-UUID','owner');

-- Bootstrap: an authenticated user creating a business becomes its owner automatically.
DROP POLICY IF EXISTS businesses_manage ON businesses;
CREATE POLICY businesses_insert ON businesses FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY businesses_update ON businesses FOR UPDATE USING (has_business_role(id, ARRAY['owner','admin'])) WITH CHECK (has_business_role(id, ARRAY['owner','admin']));
CREATE POLICY businesses_delete ON businesses FOR DELETE USING (has_business_role(id, ARRAY['owner']));

CREATE OR REPLACE FUNCTION bootstrap_business_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounts_erp, public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO user_business_roles(user_id,user_email,business_id,role)
    VALUES(auth.uid(),coalesce(auth.email(),''),NEW.id,'owner')
    ON CONFLICT(user_email,business_id) DO UPDATE SET user_id=excluded.user_id, role='owner';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS business_owner_bootstrap ON businesses;
CREATE TRIGGER business_owner_bootstrap AFTER INSERT ON businesses FOR EACH ROW EXECUTE FUNCTION bootstrap_business_owner();
