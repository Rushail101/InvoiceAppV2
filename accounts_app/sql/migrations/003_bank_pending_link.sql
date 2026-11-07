-- Bank rows imported "on hold" until you link them to an invoice / bill (Bank Receipts screen).
-- They are saved with NO journal entry; the entry is created when you link them.
SET search_path TO accounts_erp, public;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS pending_link boolean DEFAULT false;
