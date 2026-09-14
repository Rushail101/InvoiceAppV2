-- PHASE 3 — Purchase Bills + GST Input Credit
-- Safe to run more than once.

alter table public.invoices
  add column if not exists itc_eligible boolean default true,
  add column if not exists itc_ineligible_reason text,
  add column if not exists purchase_order_ref text,
  add column if not exists grn_ref text,
  add column if not exists journal_posted boolean default false;

-- Input GST is an asset (recoverable tax credit), not a liability.
update public.accounts
set group = 'asset',
    sub_group = 'Current Assets',
    description = 'Eligible GST paid on purchases (input tax credit)'
where name = 'GST Input Credit';

-- Accounts needed for the purchase journal. Existing businesses get them;
-- existing rows are left untouched.
insert into public.accounts (business_id, code, name, group, sub_group, description)
select b.id, '2210', 'Input CGST', 'asset', 'Current Assets', 'CGST paid on purchases eligible for ITC'
from public.businesses b
where not exists (select 1 from public.accounts a where a.business_id = b.id and a.name = 'Input CGST');

insert into public.accounts (business_id, code, name, group, sub_group, description)
select b.id, '2220', 'Input SGST', 'asset', 'Current Assets', 'SGST paid on purchases eligible for ITC'
from public.businesses b
where not exists (select 1 from public.accounts a where a.business_id = b.id and a.name = 'Input SGST');

insert into public.accounts (business_id, code, name, group, sub_group, description)
select b.id, '2230', 'Input IGST', 'asset', 'Current Assets', 'IGST paid on purchases eligible for ITC'
from public.businesses b
where not exists (select 1 from public.accounts a where a.business_id = b.id and a.name = 'Input IGST');

insert into public.accounts (business_id, code, name, group, sub_group, description)
select b.id, '2140', 'GST Payable (RCM)', 'liability', 'Current Liabilities', 'GST payable under reverse charge'
from public.businesses b
where not exists (select 1 from public.accounts a where a.business_id = b.id and a.name = 'GST Payable (RCM)');
