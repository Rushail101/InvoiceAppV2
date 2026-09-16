SET search_path TO accounts_erp, public;

-- Needed for GSTR3BView's "Save Review Snapshot" upsert (one row per
-- business+return type+period, so re-saving the same period updates
-- instead of duplicating).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_gst_return_snapshots
  ON accounts_erp.gst_return_snapshots (business_id, return_type, period);
