-- Bank credit <-> payment links.
--
-- A bank credit (money in) is tied to the payment(s) recorded against invoices / proformas.
-- Many-to-many with amounts, so:
--   * one bank credit can pay several invoices (several payments, each linked for its share)
--   * one payment can be covered by several bank credits (partial / split receipts)
-- Linking only TAGS. It never creates or changes journal entries, payments or bank rows,
-- so nothing is double-counted. Safe to re-run.
SET search_path TO accounts_erp, public;

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
