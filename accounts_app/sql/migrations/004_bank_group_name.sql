-- You name and categorise imported bank rows yourself; rows given the same name are grouped together.
SET search_path TO accounts_erp, public;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS group_name text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS group_category text;
