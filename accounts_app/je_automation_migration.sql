-- ─────────────────────────────────────────────────────────────
-- JE Automation Migration
-- Run this in Supabase SQL Editor once to add journal_posted
-- tracking to bank_transactions
-- ─────────────────────────────────────────────────────────────

-- 1. Add journal_posted flag to bank_transactions
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS journal_posted boolean DEFAULT false;

-- 2. Add source tracking to journal_entries (if not already present)
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

-- 3. Index for fast lookup of JEs by source
CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON journal_entries (source, source_id);

-- 4. Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('bank_transactions', 'journal_entries')
  AND column_name IN ('journal_posted', 'source', 'source_id')
ORDER BY table_name, column_name;
