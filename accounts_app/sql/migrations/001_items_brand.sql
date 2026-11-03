-- Item Master: add an optional brand so the same product can have a separate
-- entry (and price) per brand/client. Safe to re-run.
SET search_path TO accounts_erp, public;

ALTER TABLE items ADD COLUMN IF NOT EXISTS brand text;
CREATE INDEX IF NOT EXISTS idx_items_brand ON items(business_id, brand);
