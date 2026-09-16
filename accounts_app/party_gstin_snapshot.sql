SET search_path TO accounts_erp, public;

-- Locks each invoice's B2B/B2C classification to the party's GST
-- registration status AT THE TIME the invoice was created, instead of
-- reading it live off the party record. Without this, adding a client's
-- GSTIN later (they cross the ₹20L mandatory-registration threshold, or
-- you just get around to entering it) silently reclassifies every one of
-- their PAST invoices from B2C to B2B in GSTR-1 — including periods
-- you've already filed.
--
--   NULL  -> pre-fix invoice, no snapshot captured yet. The app falls
--            back to the party's live GSTIN for these (old behaviour) —
--            open the invoice and use "GST status for this invoice" to
--            lock it once, if its classification looks wrong.
--   ''    -> explicitly confirmed unregistered at invoice time (B2C)
--   'GSTIN...' -> explicitly confirmed registered with this GSTIN at
--            invoice time (B2B)
ALTER TABLE accounts_erp.invoices
  ADD COLUMN IF NOT EXISTS party_gstin_snapshot text;
