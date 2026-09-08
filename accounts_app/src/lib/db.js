// db.js — all Supabase queries in one place

export let supabase = null;

export function initSupabase(client) { supabase = client; }

// ── Generic ────────────────────────────────────────────────────────────────────
async function q(table, method, ...args) {
  const { data, error } = await supabase.from(table)[method](...args);
  if (error) throw error;
  return data;
}

// Supabase/PostgREST caps any single .select() response at a default of
// 1000 rows, silently — no error, just a truncated array. Any table that
// grows past that (journal_lines is usually first, since every voucher
// writes 2+ rows) starts dropping its newest rows from what the app sees,
// which is why journal entries can suddenly show ₹0.00 debit/credit even
// though the entry itself is fine. This helper pages through with
// .range() until a page comes back short, so every row loads regardless
// of table size.
async function fetchAll(table, { order, select } = {}) {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  for (;;) {
    let query = supabase.from(table).select(select || '*');
    // order can be a single {column, ascending} or an array of them, applied
    // in sequence — e.g. [dateColumn, createdAtColumn] sorts by date first
    // and breaks ties by actual entry order.
    for (const o of (Array.isArray(order) ? order : (order ? [order] : []))) {
      query = query.order(o.column, { ascending: o.ascending !== false });
    }
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// ── Load all data ──────────────────────────────────────────────────────────────
export async function loadAll() {
  const [biz, inv, par, exp, pay, accs, jnl, jlines, cns, banks, bankTxns, itms, dcs, locks, rules, g2b] = await Promise.all([
    fetchAll('businesses', { order: { column: 'name', ascending: true } }),
    fetchAll('invoices', { order: { column: 'created_at', ascending: false } }),
    fetchAll('parties', { order: { column: 'name', ascending: true } }),
    fetchAll('expenses', { order: [{ column: 'expense_date', ascending: false }, { column: 'created_at', ascending: false }] }),
    fetchAll('payments', { order: [{ column: 'payment_date', ascending: false }, { column: 'created_at', ascending: false }] }),
    fetchAll('accounts', { order: { column: 'code', ascending: true } }),
    fetchAll('journal_entries', { order: [{ column: 'entry_date', ascending: false }, { column: 'created_at', ascending: false }] }),
    fetchAll('journal_lines'),
    fetchAll('credit_notes', { order: { column: 'created_at', ascending: false } }),
    fetchAll('bank_accounts', { order: { column: 'name', ascending: true } }),
    fetchAll('bank_transactions', { order: { column: 'txn_date', ascending: false } }),
    fetchAll('items', { order: { column: 'name', ascending: true } }),
    fetchAll('delivery_challans', { order: { column: 'challan_date', ascending: false } }),
    fetchAll('period_locks').catch(() => []),
    fetchAll('bank_rules', { order: { column: 'priority', ascending: true } }).catch(() => []),
    fetchAll('gstr2b_entries', { order: { column: 'return_period', ascending: false } }).catch(() => []),
  ]);
  return {
    businesses: biz,
    invoices: inv,
    parties: par,
    expenses: exp,
    payments: pay,
    accounts: accs,
    journalEntries: jnl,
    journalLines: jlines,
    creditNotes: cns,
    bankAccounts: banks,
    bankTransactions: bankTxns,
    items: itms,
    challans: dcs,
    periodLocks: locks || [],
    bankRules: rules || [],
    gstr2bEntries: g2b || [],
  };
}

// ── GSTR-2B Reconciliation ──────────────────────────────────────────────────
// Cross-checks Input Tax Credit actually claimed (vendor bills raised in the
// app, type='purchase') against what suppliers filed in GSTR-2B for the same
// return period — flags ITC claimed with no matching 2B entry (audit risk:
// may need reversal) and 2B entries with no matching bill booked yet (ITC
// being left unclaimed). Import is a manual paste/CSV of the 2B summary
// rather than a live GSTN API pull (out of scope here), but the comparison
// itself is real.
export async function saveGstr2bEntries(rows) {
  if (!rows?.length) return;
  const { error } = await supabase.from('gstr2b_entries').insert(rows);
  if (error) throw error;
}
export async function deleteGstr2bPeriod(businessId, period) {
  const { error } = await supabase.from('gstr2b_entries').delete().eq('business_id', businessId).eq('return_period', period);
  if (error) throw error;
}

// ── Period Locking ────────────────────────────────────────────────────────────
// A locked period is stored as one row per (business_id, fiscal year start
// year) in `period_locks`. Once locked, entry_date falling inside that FY is
// rejected by every posting path below (invoice accrual, expense, payment,
// bank import, manual journal) and by journal/invoice/expense/payment
// deletion — the goal is that a completed, filed financial year's opening
// balances can't be nudged by an accidental edit months later. `fetchAll`
// above tolerates the table not existing yet (falls back to []) so this is
// safe to ship before the migration has been run; isDateLocked below does
// the same, since running an app instance in "before the migration" state
// should behave as if nothing is locked, not throw.
let _periodLocksCache = null;
export async function getPeriodLocks() {
  if (_periodLocksCache) return _periodLocksCache;
  try { _periodLocksCache = await fetchAll('period_locks'); }
  catch { _periodLocksCache = []; }
  return _periodLocksCache;
}
export function invalidatePeriodLockCache() { _periodLocksCache = null; }

export async function lockPeriod(businessId, fyStartYear, note) {
  const { error } = await supabase.from('period_locks').insert({ business_id: businessId, fy_start_year: fyStartYear, note: note || null });
  if (error) throw error;
  invalidatePeriodLockCache();
}
export async function unlockPeriod(businessId, fyStartYear) {
  const { error } = await supabase.from('period_locks').delete().eq('business_id', businessId).eq('fy_start_year', fyStartYear);
  if (error) throw error;
  invalidatePeriodLockCache();
}

function fyStartYearOfDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear(), m = d.getMonth(); // Apr(3) starts the Indian FY
  return m >= 3 ? y : y - 1;
}

async function isDateLocked(businessId, dateStr) {
  if (!dateStr) return false;
  const locks = await getPeriodLocks();
  const fy = fyStartYearOfDate(dateStr);
  return locks.some(l => l.business_id === businessId && Number(l.fy_start_year) === fy);
}
export { isDateLocked };

// ── Businesses ─────────────────────────────────────────────────────────────────
export async function saveBusiness(data, id) {
  if (id) {
    const { error } = await supabase.from('businesses').update(data).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('businesses').insert(data);
    if (error) throw error;
  }
}
export async function deleteBusiness(id) {
  const { error } = await supabase.from('businesses').delete().eq('id', id);
  if (error) throw error;
}

// ── Item Master ────────────────────────────────────────────────────────────────
export async function saveItem(data, id) {
  if (id) {
    const { error } = await supabase.from('items').update(data).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('items').insert(data);
    if (error) throw error;
  }
}
export async function deleteItem(id) {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
}

// The Item Master screen is hidden from the nav (see App.jsx) — instead the
// catalog auto-builds itself from what's actually invoiced. Matches by name
// (case-insensitive) within the same business: updates price/HSN/GST% on a
// match, inserts a new row otherwise. Best-effort — called from saveInvoice
// and never allowed to block or fail the invoice save itself.
async function autoSaveCatalogItems(items, businessId) {
  if (!businessId || !items?.length) return;
  for (const it of items) {
    const name = (it.description || '').trim();
    if (!name) continue;
    const { data: existing } = await supabase
      .from('items')
      .select('id')
      .eq('business_id', businessId)
      .ilike('name', name)
      .limit(1)
      .maybeSingle();
    const payload = {
      business_id: businessId,
      name,
      hsn_code: it.hsn_code || null,
      sale_price: Number(it.unit_price) || 0,
      tax_percent: Number(it.tax_percent) || 0,
    };
    if (existing) await supabase.from('items').update(payload).eq('id', existing.id);
    else await supabase.from('items').insert(payload);
  }
}

// ── Parties ────────────────────────────────────────────────────────────────────
export async function saveParty(data, id) {
  if (id) {
    const { error } = await supabase.from('parties').update(data).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('parties').insert(data);
    if (error) throw error;
  }
}
export async function deleteParty(id) {
  const { error } = await supabase.from('parties').delete().eq('id', id);
  if (error) throw error;
}

// ── Accounts (Chart of Accounts) ───────────────────────────────────────────────
export async function saveAccount(data, id) {
  if (id) { await supabase.from('accounts').update(data).eq('id', id); }
  else { await supabase.from('accounts').insert({ ...data, business_id: data.business_id }); }
}
export async function seedAccounts(bizId, defaults) {
  const rows = defaults.map(a => ({ ...a, business_id: bizId }));
  await supabase.from('accounts').insert(rows);
}

// ── Invoices ───────────────────────────────────────────────────────────────────// Safe column list — only fields that exist in the DB schema
// This prevents "column not found" errors when running old schema versions
const INV_COLS = [
  'business_id','party_id','invoice_number','type','status',
  'issue_date','due_date','notes','discount_percent','discount_amount',
  'subtotal','cgst_amount','sgst_amount','igst_amount','tax_amount',
  'total','is_interstate','tds_amount',
];

function pickInvCols(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([k]) => INV_COLS.includes(k))
  );
}

export async function saveInvoice(inv, items, id) {
  const invData = pickInvCols(inv);
  if (!id) invData.journal_posted = false;
  let rid = id;
  if (id) {
    const { error } = await supabase.from('invoices').update(invData).eq('id', id);
    if (error) throw new Error(`Invoice save failed: ${error.message}. Run the migration SQL from Settings → SQL Setup.`);
    await supabase.from('invoice_items').delete().eq('invoice_id', id);
  } else {
    const { data, error } = await supabase.from('invoices').insert(invData).select().single();
    if (error) throw new Error(`Invoice save failed: ${error.message}. Run the migration SQL from Settings → SQL Setup.`);
    rid = data.id;
  }
  if (items?.length) {
    const rows = items.map(it => ({
      invoice_id: rid,
      description: it.description,
      hsn_code: it.hsn_code || null,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      discount_percent: Number(it.discount_percent || 0),
      tax_percent: Number(it.tax_percent || 0),
      taxable_amount: Number(it.taxable || 0),
      cgst_amount: Number(it.cgst || 0),
      sgst_amount: Number(it.sgst || 0),
      igst_amount: Number(it.igst || 0),
      amount: Number(it.lineTotal || 0),
    }));
    const { error } = await supabase.from('invoice_items').insert(rows);
    if (error) throw new Error(`Invoice items save failed: ${error.message}`);
  }
  autoSaveCatalogItems(items, inv.business_id).catch(() => {});
  return rid;
}

// ── Invoice → Journal Entry (Accrual) ──────────────────────────────────────────
// Raising a real tax invoice (or vendor bill) creates a receivable/payable and
// recognizes revenue/cost + output/input GST immediately — that's what makes
// it different from a draft or proforma, which are just quotes and never
// touch the ledger. This mirrors postExpenseJournal/postPaymentJournal below:
// never throws, only flips invoices.journal_posted once the entry + lines are
// both confirmed written, and is safe to call again (it's a no-op) on an
// invoice that's already posted, a draft, a proforma, or a cancelled invoice.
//
// Because accrual happens here, at invoice time, postPaymentJournal (below)
// stops recognizing revenue/cost a second time when a payment comes in
// against an already-accrued invoice — it just clears the receivable/payable
// instead. A payment against a proforma (no accrual yet — see convertProforma)
// still hits revenue directly, same as before, since there's no invoice yet
// to accrue against.
async function postInvoiceJournal(invRow) {
  if (!invRow) return { journalId: null, skipped: true, skipReason: 'not_found' };
  if (invRow.journal_posted) return { journalId: null, skipped: true, skipReason: 'already_posted' };
  if (['draft', 'proforma', 'cancelled'].includes(invRow.status)) {
    return { journalId: null, skipped: true, skipReason: 'not_finalized' };
  }
  if (!invRow.business_id) return { journalId: null, skipped: true, skipReason: 'no_business_id' };
  if (await isDateLocked(invRow.business_id, invRow.issue_date)) {
    return { journalId: null, skipped: true, skipReason: 'period_locked' };
  }

  const isPurchase = invRow.type === 'purchase';
  const subtotal = Number(invRow.subtotal || 0);
  const taxTotal = (Number(invRow.cgst_amount || 0) + Number(invRow.sgst_amount || 0) + Number(invRow.igst_amount || 0)) || Number(invRow.tax_amount || 0);
  const total = Number(invRow.total || 0);

  let lines = [];
  if (isPurchase) {
    const payableAcct = await findAccount(invRow.business_id, 'Accounts Payable');
    const costAcct = (await findAccount(invRow.business_id, 'Raw Materials')) || (await findAccount(invRow.business_id, 'Cost of Goods Sold'));
    const itcAcct = await findAccount(invRow.business_id, 'GST Input Credit');
    if (!payableAcct || !costAcct) return { journalId: null, skipped: true, skipReason: 'account_not_found' };
    if (taxTotal > 0 && !itcAcct) return { journalId: null, skipped: true, skipReason: 'account_not_found' };
    lines.push({ account_id: costAcct.id, type: 'debit', amount: subtotal, narration: 'Vendor bill — goods/services' });
    if (taxTotal > 0) lines.push({ account_id: itcAcct.id, type: 'debit', amount: taxTotal, narration: 'Input Tax Credit' });
    lines.push({ account_id: payableAcct.id, type: 'credit', amount: total, narration: 'Vendor bill raised' });
  } else {
    const receivableAcct = await findAccount(invRow.business_id, 'Accounts Receivable');
    const salesAcct = await findAccount(invRow.business_id, 'Sales Revenue');
    const outputGstAcct = await findAccount(invRow.business_id, 'GST Payable (Output)');
    if (!receivableAcct || !salesAcct) return { journalId: null, skipped: true, skipReason: 'account_not_found' };
    if (taxTotal > 0 && !outputGstAcct) return { journalId: null, skipped: true, skipReason: 'account_not_found' };
    lines.push({ account_id: receivableAcct.id, type: 'debit', amount: total, narration: 'Invoice raised' });
    lines.push({ account_id: salesAcct.id, type: 'credit', amount: subtotal, narration: 'Sale accrued' });
    if (taxTotal > 0) lines.push({ account_id: outputGstAcct.id, type: 'credit', amount: taxTotal, narration: 'Output GST' });
  }

  const dr = lines.filter(l => l.type === 'debit').reduce((s, l) => s + l.amount, 0);
  const cr = lines.filter(l => l.type === 'credit').reduce((s, l) => s + l.amount, 0);
  if (Math.abs(dr - cr) > 0.01) return { journalId: null, skipped: true, skipReason: 'unbalanced_entry' };
  if (dr <= 0) return { journalId: null, skipped: true, skipReason: 'zero_amount' };

  const { data: jnl, error: je } = await supabase.from('journal_entries').insert({
    business_id: invRow.business_id,
    entry_date: invRow.issue_date,
    reference: invRow.invoice_number || `INV-${invRow.id.slice(0, 8)}`,
    description: isPurchase ? `Vendor bill — ${invRow.invoice_number || ''}` : `Tax invoice — ${invRow.invoice_number || ''}`,
    narration: invRow.notes || '',
    source: 'invoice',
    source_id: invRow.id,
  }).select().single();
  if (je) return { journalId: null, skipped: true, skipReason: je.message };

  const { error: lErr } = await supabase.from('journal_lines').insert(lines.map(l => ({ ...l, journal_id: jnl.id })));
  if (lErr) return { journalId: jnl.id, skipped: true, skipReason: lErr.message };

  await supabase.from('invoices').update({ journal_posted: true }).eq('id', invRow.id);
  return { journalId: jnl.id, skipped: false };
}

// Save + accrue in one step — the function every UI call site should use
// going forward instead of the bare saveInvoice(). Re-fetches the row after
// save so postInvoiceJournal always sees the real current status/amounts,
// including on edits (e.g. a draft being finalized).
export async function saveInvoiceWithJournal(inv, items, id) {
  const rid = await saveInvoice(inv, items, id);
  const { data: invRow } = await supabase.from('invoices').select('*').eq('id', rid).single();
  const result = await postInvoiceJournal(invRow);
  return { id: rid, ...result };
}

// Retroactively post a journal entry for an invoice that never got one
// (predates this fix, or was skipped for a missing account at the time).
// See JournalHealthView.
export async function repostInvoiceJournal(invRow) {
  return postInvoiceJournal(invRow);
}

// Converts a proforma to a real tax invoice AND runs the accounting side of
// that conversion in one place, instead of leaving callers to just flip the
// status column directly (which is how this used to silently skip the
// accrual entry entirely). Two things happen:
//   1. The invoice accrual entry posts now, for the first time, at the real
//      issue date — Dr Accounts Receivable / Cr Sales Revenue + Output GST.
//   2. Any advance payments already collected while it was a proforma were
//      posted as Dr Bank / Cr Sales Revenue at the time (there was no
//      receivable yet to clear). Now that step 1 has created one, those
//      advances are reclassified with a single entry — Dr Sales Revenue /
//      Cr Accounts Receivable for the sum already collected — so the
//      combined effect of the old advance entries + this one is exactly
//      Dr Bank / Cr Accounts Receivable, and revenue is recognized once,
//      not twice.
export async function convertProformaToInvoice(invId, { newInvoiceNumber, issueDate, newStatus }, priorPayments) {
  const { data: before, error: beforeErr } = await supabase.from('invoices').select('invoice_number').eq('id', invId).single();
  if (beforeErr) throw beforeErr;

  const { error: updErr } = await supabase.from('invoices')
    .update({ status: newStatus, invoice_number: newInvoiceNumber, proforma_number: before.invoice_number, issue_date: issueDate })
    .eq('id', invId);
  if (updErr) throw updErr;

  const { data: invRow, error: fetchErr } = await supabase.from('invoices').select('*').eq('id', invId).single();
  if (fetchErr) throw fetchErr;

  const accrualResult = await postInvoiceJournal(invRow);

  let reclassResult = { skipped: true, skipReason: 'no_prior_payments' };
  const advanceTotal = (priorPayments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  if (accrualResult.journalId && advanceTotal > 0.01) {
    const salesAcct = await findAccount(invRow.business_id, 'Sales Revenue');
    const receivableAcct = await findAccount(invRow.business_id, 'Accounts Receivable');
    if (salesAcct && receivableAcct) {
      const { data: rjnl, error: rje } = await supabase.from('journal_entries').insert({
        business_id: invRow.business_id,
        entry_date: issueDate,
        reference: invRow.invoice_number,
        description: `Reclassify advance(s) against ${invRow.invoice_number} to receivable`,
        narration: 'Proforma advance reclassified on conversion to tax invoice',
        source: 'invoice_conversion',
        source_id: invRow.id,
      }).select().single();
      if (!rje) {
        const { error: rlErr } = await supabase.from('journal_lines').insert([
          { journal_id: rjnl.id, account_id: salesAcct.id, type: 'debit', amount: advanceTotal, narration: 'Reclassify advance' },
          { journal_id: rjnl.id, account_id: receivableAcct.id, type: 'credit', amount: advanceTotal, narration: 'Reclassify advance' },
        ]);
        reclassResult = rlErr ? { skipped: true, skipReason: rlErr.message } : { skipped: false, journalId: rjnl.id };
      } else {
        reclassResult = { skipped: true, skipReason: rje.message };
      }
    } else {
      reclassResult = { skipped: true, skipReason: 'account_not_found' };
    }
  }
  return { invoiceId: invId, accrual: accrualResult, reclass: reclassResult };
}

export async function getInvoiceItems(invoiceId) {
  const { data } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId);
  return data || [];
}

export async function updateInvoiceStatus(id, status) {
  await supabase.from('invoices').update({ status }).eq('id', id);
}

// Mark one or more invoices as GST-filed (or un-mark them). `period` is the
// GSTR-1 return period they were filed under, e.g. "2026-07" — optional,
// mainly useful when bulk-marking a whole month from the GSTR-1 screen.
export async function markGSTFiled(ids, filed = true, period = null) {
  if (!ids?.length) return;
  const payload = filed
    ? { gst_filed: true, gst_filed_at: new Date().toISOString(), gst_filed_period: period }
    : { gst_filed: false, gst_filed_at: null, gst_filed_period: null };
  const { error } = await supabase.from('invoices').update(payload).in('id', ids);
  if (error) throw new Error(`GST filed update failed: ${error.message}`);
}

export async function deleteInvoice(id) {
  const { data: row } = await supabase.from('invoices').select('business_id, issue_date').eq('id', id).single();
  if (row && await isDateLocked(row.business_id, row.issue_date)) {
    throw new Error('This invoice falls in a locked financial year and cannot be deleted. Unlock the period first (Settings → Period Locking).');
  }
  await supabase.from('invoices').delete().eq('id', id);
}

// ── Payments ───────────────────────────────────────────────────────────────────
export async function savePayment(data) {
  const { error } = await supabase.from('payments').insert(data);
  if (error) throw error;
}
export async function deletePayment(id) {
  const { data: row } = await supabase.from('payments').select('business_id, payment_date').eq('id', id).single();
  if (row && await isDateLocked(row.business_id, row.payment_date)) {
    throw new Error('This payment falls in a locked financial year and cannot be deleted. Unlock the period first (Settings → Period Locking).');
  }
  await supabase.from('payments').delete().eq('id', id);
}

// Auto-post a payment → journal entry. Revenue/cost is recognized here, at
// COLLECTION time — not when the invoice is raised — since a payment can
// trail the invoice by weeks and often arrives as a partial/advance amount;
// each payment recognizes exactly the amount actually received, whether
// that's a 50% advance or the final balance. Handles both directions:
//   - Sale invoice payment (customer pays us): Dr Bank Account / Cr Sales Revenue
//   - Purchase invoice payment (we pay a vendor bill): Dr Cost of Goods Sold / Cr Bank Account
// `invoice_type` on the incoming data tells us which; defaults to 'sale' since
// that's the only case Bulk Payment ever sends (it already filters to sale
// invoices only) and it's the more common case for the invoice payment modal.
// Bank-imported payments already get their journal entry from
// saveBankTxnWithJournal, so BankImport.jsx deliberately keeps calling the
// plain savePayment() above to avoid double-posting the same money in.
// Shared by savePaymentWithJournal (new payment) and repostPaymentJournal
// (retroactively posting an existing payment row that never got a journal —
// see JournalHealthView). Never throws; always returns a skipped/skipReason
// result so a batch re-post can continue past individual failures.
// `linkedInvoice`, when passed, tells us whether the invoice this payment is
// against has ALREADY had its accrual entry posted (see postInvoiceJournal
// above — real tax invoices and vendor bills accrue at issue time now, not
// proforma quotes). If it has, revenue/cost was already recognized there, so
// this payment must only clear the receivable/payable — Dr Bank / Cr
// Accounts Receivable (sale) or Dr Accounts Payable / Cr Bank (purchase) —
// instead of hitting Sales Revenue / Cost of Goods Sold a second time. If
// there's no linked invoice, or it hasn't accrued yet (a proforma advance —
// see convertProformaToInvoice, which reclassifies these once the proforma
// converts), this falls back to the original direct-to-revenue behaviour.
async function postPaymentJournal(payRow, isPurchase, linkedInvoice) {
  if (!payRow.business_id) return { journalId: null, skipped: true, skipReason: 'no_business_id' };
  if (await isDateLocked(payRow.business_id, payRow.payment_date)) {
    return { journalId: null, skipped: true, skipReason: 'period_locked' };
  }

  const accrued = !!(linkedInvoice && linkedInvoice.journal_posted);
  const bankAcct = await findAccount(payRow.business_id, 'Bank Account');
  const otherAcct = accrued
    ? await findAccount(payRow.business_id, isPurchase ? 'Accounts Payable' : 'Accounts Receivable')
    : (isPurchase
        ? (await findAccount(payRow.business_id, 'Cost of Goods Sold')) || (await findAccount(payRow.business_id, 'Raw Materials'))
        : await findAccount(payRow.business_id, 'Sales Revenue'));
  if (!bankAcct || !otherAcct) return { journalId: null, skipped: true, skipReason: 'account_not_found' };

  const desc = accrued
    ? (isPurchase ? `Vendor payment — clears AP${payRow.method ? ' — ' + payRow.method : ''}` : `Payment received — clears AR${payRow.method ? ' — ' + payRow.method : ''}`)
    : (isPurchase ? `Bill payment${payRow.method ? ' — ' + payRow.method : ''}` : `Payment received${payRow.method ? ' — ' + payRow.method : ''}`);

  const { data: jnl, error: je } = await supabase.from('journal_entries').insert({
    business_id: payRow.business_id,
    entry_date: payRow.payment_date,
    reference: payRow.reference || `PAY-${payRow.id.slice(0, 8)}`,
    description: desc,
    narration: payRow.notes || '',
    source: 'payment',
    source_id: payRow.id,
  }).select().single();
  if (je) return { journalId: null, skipped: true, skipReason: je.message };

  const lines = isPurchase
    ? [
        { journal_id: jnl.id, account_id: otherAcct.id, type: 'debit', amount: Number(payRow.amount), narration: payRow.method || 'Bill payment' },
        { journal_id: jnl.id, account_id: bankAcct.id, type: 'credit', amount: Number(payRow.amount), narration: payRow.method || 'Bill payment' },
      ]
    : [
        { journal_id: jnl.id, account_id: bankAcct.id, type: 'debit', amount: Number(payRow.amount), narration: payRow.method || 'Payment received' },
        { journal_id: jnl.id, account_id: otherAcct.id, type: 'credit', amount: Number(payRow.amount), narration: payRow.method || 'Payment received' },
      ];
  const { error: lErr } = await supabase.from('journal_lines').insert(lines);
  if (lErr) return { journalId: jnl.id, skipped: true, skipReason: lErr.message };

  return { journalId: jnl.id, skipped: false };
}

export async function savePaymentWithJournal(data, invoices) {
  const isPurchase = data.invoice_type === 'purchase';
  const { invoice_type, ...payRecord } = data; // invoice_type isn't a real payments column
  const { data: payRow, error } = await supabase.from('payments').insert(payRecord).select().single();
  if (error) throw error;

  const linkedInvoice = (invoices || []).find(i => i.id === payRow.invoice_id) || null;
  const result = await postPaymentJournal(payRow, isPurchase, linkedInvoice);
  return { id: payRow.id, ...result };
}

// Retroactively post a journal entry for a payment that was saved without one
// (e.g. account wasn't set up yet at the time, or it predates the JE-lines
// column-name fix). `invoices` is the loaded invoice list, used to figure out
// whether this was a sale or purchase payment via the linked invoice's type,
// and whether that invoice has already accrued.
export async function repostPaymentJournal(payRow, invoices) {
  const inv = (invoices || []).find(i => i.id === payRow.invoice_id);
  const isPurchase = inv?.type === 'purchase';
  const result = await postPaymentJournal(payRow, isPurchase, inv || null);
  return { id: payRow.id, ...result };
}

// ── Journal ────────────────────────────────────────────────────────────────────
export async function saveJournal(entry, lines, id) {
  if (await isDateLocked(entry.business_id, entry.entry_date)) {
    throw new Error('That date falls in a locked financial year. Unlock the period first (Settings → Period Locking).');
  }
  if (id) {
    // Edit mode: also block if the entry being edited currently sits in a
    // locked period, even if the new date doesn't (covers moving an entry
    // OUT of a locked year, which would still be rewriting locked history).
    const { data: existing } = await supabase.from('journal_entries').select('business_id, entry_date').eq('id', id).single();
    if (existing && await isDateLocked(existing.business_id, existing.entry_date)) {
      throw new Error('This journal entry falls in a locked financial year and cannot be edited. Unlock the period first (Settings → Period Locking).');
    }
    // Update the entry header, then replace all its lines wholesale
    // (simplest way to keep debit/credit totals consistent after edits).
    const { error } = await supabase.from('journal_entries').update(entry).eq('id', id);
    if (error) throw error;
    const { error: delErr } = await supabase.from('journal_lines').delete().eq('journal_id', id);
    if (delErr) throw delErr;
    const rows = lines.map(l => ({ ...l, journal_id: id }));
    const { error: e2 } = await supabase.from('journal_lines').insert(rows);
    if (e2) throw e2;
    return id;
  }
  const { data, error } = await supabase.from('journal_entries').insert(entry).select().single();
  if (error) throw error;
  const jid = data.id;
  const rows = lines.map(l => ({ ...l, journal_id: jid }));
  const { error: e2 } = await supabase.from('journal_lines').insert(rows);
  if (e2) throw e2;
  return jid;
}
export async function deleteJournal(id) {
  const { data: existing } = await supabase.from('journal_entries').select('business_id, entry_date').eq('id', id).single();
  if (existing && await isDateLocked(existing.business_id, existing.entry_date)) {
    throw new Error('This journal entry falls in a locked financial year and cannot be deleted. Unlock the period first (Settings → Period Locking).');
  }
  await supabase.from('journal_lines').delete().eq('journal_id', id);
  await supabase.from('journal_entries').delete().eq('id', id);
}

// ── Credit Notes ───────────────────────────────────────────────────────────────
// Plain insert only — no ledger effect. Kept for callers that explicitly
// don't want a journal side-effect (there currently are none; UI should use
// saveCreditNoteWithJournal below). Left in place since repostCreditNoteJournal
// needs a way to have already-inserted rows to retroactively post against.
export async function saveCreditNote(cn, items) {
  const { data, error } = await supabase.from('credit_notes').insert({ ...cn, journal_posted: false }).select().single();
  if (error) throw error;
  const cnId = data.id;
  if (items?.length) {
    await supabase.from('credit_note_items').insert(items.map(i => ({ ...i, credit_note_id: cnId })));
  }
  return cnId;
}
export async function getCreditNoteItems(cnId) {
  const { data } = await supabase.from('credit_note_items').select('*').eq('credit_note_id', cnId);
  return data || [];
}

// Issuing a credit note reduces what the customer owes and reverses the
// revenue + output GST that were accrued when the original invoice was
// raised — previously this only wrote a database row and rendered a PDF,
// with no journal effect at all, so Accounts Receivable stayed overstated
// and output GST stayed unadjusted. Dr Sales Revenue + Dr GST Payable
// (Output) / Cr Accounts Receivable, for the credit note's own subtotal/tax/
// total (not the original invoice's — a partial credit note only reverses
// its own amount).
async function postCreditNoteJournal(cnRow) {
  if (!cnRow.business_id) return { journalId: null, skipped: true, skipReason: 'no_business_id' };
  if (cnRow.journal_posted) return { journalId: null, skipped: true, skipReason: 'already_posted' };
  if (await isDateLocked(cnRow.business_id, cnRow.cn_date)) return { journalId: null, skipped: true, skipReason: 'period_locked' };

  const receivableAcct = await findAccount(cnRow.business_id, 'Accounts Receivable');
  const salesAcct = await findAccount(cnRow.business_id, 'Sales Revenue');
  const outputGstAcct = await findAccount(cnRow.business_id, 'GST Payable (Output)');
  if (!receivableAcct || !salesAcct) return { journalId: null, skipped: true, skipReason: 'account_not_found' };

  const subtotal = Number(cnRow.subtotal || 0);
  const taxTotal = Number(cnRow.cgst_amount || 0) + Number(cnRow.sgst_amount || 0) + Number(cnRow.igst_amount || 0);
  const total = Number(cnRow.total || 0);
  if (taxTotal > 0 && !outputGstAcct) return { journalId: null, skipped: true, skipReason: 'account_not_found' };

  const lines = [{ account_id: salesAcct.id, type: 'debit', amount: subtotal, narration: 'Credit note — sales reversal' }];
  if (taxTotal > 0) lines.push({ account_id: outputGstAcct.id, type: 'debit', amount: taxTotal, narration: 'Credit note — output GST reversal' });
  lines.push({ account_id: receivableAcct.id, type: 'credit', amount: total, narration: 'Credit note issued' });

  const { data: jnl, error: je } = await supabase.from('journal_entries').insert({
    business_id: cnRow.business_id,
    entry_date: cnRow.cn_date,
    reference: cnRow.cn_number || `CN-${cnRow.id.slice(0, 8)}`,
    description: `Credit note — ${cnRow.cn_number || ''}`,
    narration: cnRow.reason || '',
    source: 'credit_note',
    source_id: cnRow.id,
  }).select().single();
  if (je) return { journalId: null, skipped: true, skipReason: je.message };

  const { error: lErr } = await supabase.from('journal_lines').insert(lines.map(l => ({ ...l, journal_id: jnl.id })));
  if (lErr) return { journalId: jnl.id, skipped: true, skipReason: lErr.message };

  await supabase.from('credit_notes').update({ journal_posted: true }).eq('id', cnRow.id);
  return { journalId: jnl.id, skipped: false };
}

export async function saveCreditNoteWithJournal(cn, items) {
  const cnId = await saveCreditNote(cn, items);
  const { data: cnRow } = await supabase.from('credit_notes').select('*').eq('id', cnId).single();
  const result = await postCreditNoteJournal(cnRow);
  return { id: cnId, ...result };
}
export async function repostCreditNoteJournal(cnRow) {
  return postCreditNoteJournal(cnRow);
}

// ── Expenses ───────────────────────────────────────────────────────────────────
export async function saveExpense(data) {
  const { error } = await supabase.from('expenses').insert({ ...data, vendor_id: data.vendor_id || null });
  if (error) throw error;
}
export async function deleteExpense(id) {
  const { data: row } = await supabase.from('expenses').select('business_id, expense_date').eq('id', id).single();
  if (row && await isDateLocked(row.business_id, row.expense_date)) {
    throw new Error('This expense falls in a locked financial year and cannot be deleted. Unlock the period first (Settings → Period Locking).');
  }
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
}

// Upload a bill/receipt file for an expense. Path is namespaced by business
// so files from different businesses never collide, with a timestamp prefix
// so re-uploading a same-named file doesn't overwrite the original.
export async function uploadExpenseAttachment(file, businessId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${businessId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from('expense-attachments').upload(path, file);
  if (error) throw error;
  return path;
}

// Bucket is private, so viewing an attachment goes through a short-lived
// signed URL generated on demand rather than a permanent public link.
export async function getExpenseAttachmentUrl(path) {
  const { data, error } = await supabase.storage.from('expense-attachments').createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteExpenseAttachment(path) {
  if (!path) return;
  await supabase.storage.from('expense-attachments').remove([path]);
}

// Auto-post expense → journal entry
async function findAccount(bizId, nameLike) {
  const { data } = await supabase.from('accounts')
    .select('*').eq('business_id', bizId).ilike('name', `%${nameLike}%`).limit(1);
  return data?.[0] || null;
}

export const CATEGORY_ACCOUNT_MAP = {
  'Raw Materials': 'Raw Materials',
  'Wages & Salaries': 'Wages',
  'Rent': 'Rent',
  'Utilities': 'Utilities',
  'Shipping & Freight': 'Shipping',
  'Marketing': 'Marketing',
  'Software': 'Software',
  'Travel': 'Travel',
  'Printing & Packaging': 'Miscellaneous',
  'Equipment': 'Fixed Assets',
  'Miscellaneous': 'Miscellaneous',
};

// Shared by saveExpenseWithJournal (new expense) and repostExpenseJournal
// (retroactively posting an existing expense row). Never throws. Only
// updates expenses.journal_posted to true once the journal entry AND its
// lines have both actually landed — previously the flag was set at insert
// time regardless of what happened afterward, so it could say "posted" for
// an expense with no journal entry at all.
async function postExpenseJournal(expRow) {
  if (await isDateLocked(expRow.business_id, expRow.expense_date)) {
    return { journalId: null, skipped: true, skipReason: 'period_locked' };
  }
  const acctName = CATEGORY_ACCOUNT_MAP[expRow.category] || 'Miscellaneous';
  const expAcct = await findAccount(expRow.business_id, acctName);
  const cashAcct = await findAccount(expRow.business_id, 'Bank Account') ||
                   await findAccount(expRow.business_id, 'Cash');
  if (!expAcct || !cashAcct) return { journalId: null, skipped: true, skipReason: 'account_not_found' };

  const { data: jnl, error: je } = await supabase.from('journal_entries').insert({
    business_id: expRow.business_id,
    entry_date: expRow.expense_date,
    reference: expRow.reference || `EXP-${expRow.id.slice(0, 8)}`,
    description: `${expRow.category}${expRow.description ? ' — ' + expRow.description : ''}`,
    narration: expRow.description || '',
    source: 'expense',
    source_id: expRow.id,
  }).select().single();
  if (je) return { journalId: null, skipped: true, skipReason: je.message };

  const { error: lErr } = await supabase.from('journal_lines').insert([
    { journal_id: jnl.id, account_id: expAcct.id, type: 'debit', amount: Number(expRow.amount), narration: expRow.category },
    { journal_id: jnl.id, account_id: cashAcct.id, type: 'credit', amount: Number(expRow.amount), narration: expRow.method || 'Payment' },
  ]);
  if (lErr) return { journalId: jnl.id, skipped: true, skipReason: lErr.message };

  // Only now, with the entry and both lines confirmed written, mark it posted.
  await supabase.from('expenses').update({ journal_posted: true }).eq('id', expRow.id);
  return { journalId: jnl.id, skipped: false };
}

export async function saveExpenseWithJournal(data) {
  // 1. Save expense — journal_posted starts false and is only flipped once
  // postExpenseJournal actually confirms the journal entry + lines exist.
  const { data: expRow, error } = await supabase.from('expenses')
    .insert({ ...data, vendor_id: data.vendor_id || null, journal_posted: false })
    .select().single();
  if (error) throw error;

  const result = await postExpenseJournal(expRow);
  return { id: expRow.id, ...result };
}

// Retroactively post a journal entry for an expense that was saved without
// one (missing Chart of Accounts entry at the time, historical data from
// before the JE-column-name fix, etc). Safe to call on any expense — pass
// only expenses that JournalHealthView has already confirmed have no
// matching journal_entries row, so this never double-posts.
export async function repostExpenseJournal(expRow) {
  const result = await postExpenseJournal(expRow);
  return { id: expRow.id, ...result };
}

// ── Bank Transaction → Journal Entry (Auto-post) ───────────────────────────────
//
// Categorization rules used to live only as hardcoded string literals here,
// matched against whatever partner/client/vendor names happened to be typed
// into the Chart of Accounts — so a rule silently stopped firing the moment
// an account got renamed, or never fired for a business whose accounts used
// different wording. Rules now live in the `bank_rules` table (per business,
// editable from Bank Import → Rules), and this list only serves as the
// one-time seed inserted the first time a business has no rules yet — see
// seedBankRules. Existing keyword/account-name matching behaviour is
// unchanged; what changed is that it's live data instead of shipped code.
export const DEFAULT_BANK_RULES = [
  { match: ['salary', 'sal credit', 'sal '], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Wages & Salaries' },
  { match: ['refund', 'reversal', 'ref credit'], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Miscellaneous Expenses' },
  { match: ['interest credit', 'int credit', 'int pd'], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Other Income' },
  { match: ['loan', 'borrowing', 'credit facility'], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Loans & Borrowings' },
  { match: ['capital', 'proprietor', 'owner', 'drawings return'], type: 'credit', debitAcct: 'Bank Account', creditAcct: "Owner's Capital" },
  { match: ['rent', 'rental'], type: 'debit', debitAcct: 'Rent', creditAcct: 'Bank Account' },
  { match: ['electricity', 'bijli', 'power', 'msed', 'bses', 'tata power'], type: 'debit', debitAcct: 'Utilities', creditAcct: 'Bank Account' },
  { match: ['freight', 'courier', 'dtdc', 'bluedart', 'fedex', 'delhivery', 'xpressbees', 'shipping'], type: 'debit', debitAcct: 'Shipping & Freight', creditAcct: 'Bank Account' },
  { match: ['gst', 'igst', 'cgst', 'sgst', 'tax challan', 'gstn', 'gst challan'], type: 'debit', debitAcct: 'GST Payable (Output)', creditAcct: 'Bank Account' },
  { match: ['tds', 'tcs', 'income tax', 'itr', 'advance tax'], type: 'debit', debitAcct: 'TDS Payable', creditAcct: 'Bank Account' },
  { match: ['salary', 'wages', 'labour', 'worker', 'tailor', 'stitching'], type: 'debit', debitAcct: 'Wages & Salaries', creditAcct: 'Bank Account' },
  { match: ['fabric', 'yarn', 'thread', 'cloth', 'material', 'raw material', 'lining', 'button', 'zip'], type: 'debit', debitAcct: 'Raw Materials', creditAcct: 'Bank Account' },
  { match: ['loan repay', 'emi', 'loan emi', 'instalment'], type: 'debit', debitAcct: 'Loans & Borrowings', creditAcct: 'Bank Account' },
  { match: ['drawings', 'personal', 'self', 'proprietor draw'], type: 'debit', debitAcct: 'Drawings', creditAcct: 'Bank Account' },
  { match: ['marketing', 'advertis', 'meta ads', 'google ads', 'facebook'], type: 'debit', debitAcct: 'Marketing & Advertising', creditAcct: 'Bank Account' },
  { match: ['software', 'subscription', 'saas', 'tally', 'zoho', 'microsoft', 'adobe'], type: 'debit', debitAcct: 'Software & Subscriptions', creditAcct: 'Bank Account' },
  { match: ['travel', 'uber', 'ola', 'petrol', 'diesel', 'cab', 'auto', 'conveyance'], type: 'debit', debitAcct: 'Travel & Conveyance', creditAcct: 'Bank Account' },
  { match: ['equipment', 'machine', 'sewing', 'machinery', 'tool', 'overlock'], type: 'debit', debitAcct: 'Fixed Assets', creditAcct: 'Bank Account' },
];

export async function seedBankRules(bizId) {
  const rows = DEFAULT_BANK_RULES.map((r, i) => ({
    business_id: bizId,
    keywords: r.match.join(','),
    txn_type: r.type,
    debit_account_name: r.debitAcct,
    credit_account_name: r.creditAcct,
    priority: i,
  }));
  const { error } = await supabase.from('bank_rules').insert(rows);
  if (error) throw error;
}
export async function saveBankRule(data, id) {
  if (id) { const { error } = await supabase.from('bank_rules').update(data).eq('id', id); if (error) throw error; }
  else { const { error } = await supabase.from('bank_rules').insert(data); if (error) throw error; }
}
export async function deleteBankRule(id) {
  const { error } = await supabase.from('bank_rules').delete().eq('id', id);
  if (error) throw error;
}

// Try rule-engine first (rules loaded from `bank_rules`, scoped to bizId);
// return { debitAcct, creditAcct, confidence, method } or null. Falls back to
// DEFAULT_BANK_RULES only if the business genuinely has no rows yet (e.g.
// migration hasn't been run/seeded), so behaviour is unchanged out of the box.
function applyRuleEngine(txn, rules, bizId) {
  const desc = (txn.description + ' ' + (txn.reference || '')).toLowerCase();
  const bizRules = (rules && rules.length) ? rules.filter(r => r.business_id === bizId) : null;
  const source = (bizRules && bizRules.length)
    ? [...bizRules].sort((a, b) => (a.priority || 0) - (b.priority || 0)).map(r => ({
        match: (r.keywords || '').split(',').map(s => s.trim()).filter(Boolean),
        type: r.txn_type, debitAcct: r.debit_account_name, creditAcct: r.credit_account_name,
      }))
    : DEFAULT_BANK_RULES;
  for (const rule of source) {
    if (rule.type !== txn.type) continue;
    for (const keyword of rule.match) {
      if (keyword && desc.includes(keyword)) {
        return { debitAcct: rule.debitAcct, creditAcct: rule.creditAcct, confidence: 'high', method: 'rule' };
      }
    }
  }
  return null;
}

// Shared by saveBankTxnWithJournal (new import) and repostBankTxnJournal
// (retroactively posting an existing bank_transactions row). Never throws —
// returns skipped/skipReason so a batch import or re-post can carry on past
// one bad row instead of aborting or (worse) leaving journal_posted=true on
// a row that never actually got an entry.
async function postBankTxnJournal(txnRow, accounts, bizId, overrideMapping, rules) {
  let mapping = overrideMapping;
  if (!mapping) mapping = applyRuleEngine(txnRow, rules, bizId);
  if (!mapping) {
    mapping = txnRow.type === 'credit'
      ? { debitAcct: 'Bank Account', creditAcct: 'Other Income', confidence: 'low', method: 'fallback' }
      : { debitAcct: 'Miscellaneous Expenses', creditAcct: 'Bank Account', confidence: 'low', method: 'fallback' };
  }

  if (!bizId) {
    console.warn('JE skipped: no business_id resolvable for bank txn', txnRow);
    return { journalId: null, mapping, skipped: true, skipReason: 'no_business_id' };
  }
  if (await isDateLocked(bizId, txnRow.txn_date || txnRow.date)) {
    return { journalId: null, mapping, skipped: true, skipReason: 'period_locked' };
  }
  const bizAccounts = accounts.filter(a => a.business_id === bizId);
  const findAcct = (name) => bizAccounts.find(a =>
    a.name.toLowerCase().includes(name.toLowerCase()) ||
    name.toLowerCase().includes(a.name.toLowerCase())
  );
  const debitAcct = findAcct(mapping.debitAcct);
  const creditAcct = findAcct(mapping.creditAcct);
  if (!debitAcct || !creditAcct) {
    console.warn('JE skipped: account not found', mapping, 'missing:', !debitAcct ? mapping.debitAcct : mapping.creditAcct);
    return { journalId: null, mapping, skipped: true, skipReason: 'account_not_found' };
  }

  const { data: jnl, error: jErr } = await supabase
    .from('journal_entries')
    .insert({
      business_id: bizId,
      entry_date: txnRow.txn_date || txnRow.date,
      reference: txnRow.reference || `BANK-${txnRow.id.slice(0, 8)}`,
      description: mapping.reason || txnRow.description || 'Bank transaction',
      narration: txnRow.description,
      source: 'bank_import',
      source_id: txnRow.id,
    })
    .select().single();
  if (jErr) return { journalId: null, mapping, skipped: true, skipReason: jErr.message };

  const { error: lErr } = await supabase.from('journal_lines').insert([
    { journal_id: jnl.id, account_id: debitAcct.id, type: 'debit', amount: txnRow.amount, narration: mapping.reason || txnRow.description },
    { journal_id: jnl.id, account_id: creditAcct.id, type: 'credit', amount: txnRow.amount, narration: mapping.reason || txnRow.description },
  ]);
  if (lErr) return { journalId: jnl.id, mapping, skipped: true, skipReason: lErr.message };

  // Only now, with the entry and both lines confirmed written, mark it posted.
  await supabase.from('bank_transactions').update({ journal_posted: true }).eq('id', txnRow.id);
  return { journalId: jnl.id, mapping, skipped: false };
}

// Main: save bank transaction + auto-generate journal entry
export async function saveBankTxnWithJournal(txnData, accounts, bizId, rules) {
  // 1. Save bank transaction record — journal_posted starts false and is only
  // flipped once postBankTxnJournal confirms the journal entry + lines exist.
  const { data: txnRow, error: txnErr } = await supabase
    .from('bank_transactions')
    .insert({
      bank_account_id: txnData.bankAccountId,
      txn_date: txnData.date,
      description: txnData.description,
      reference: txnData.reference || '',
      type: txnData.type,
      amount: txnData.amount,
      reconciled: true,
      party_id: txnData.partyId || null,
      journal_posted: false,
    })
    .select().single();
  if (txnErr) throw txnErr;

  // 2. Determine debit/credit accounts — user-edited overrides take priority,
  // then rule engine, then fallback (no AI) — resolved inside postBankTxnJournal.
  let overrideMapping = null;
  if (txnData._overrideDebit && txnData._overrideCredit) {
    overrideMapping = { debitAcct: txnData._overrideDebit, creditAcct: txnData._overrideCredit, confidence: 'high', method: 'user' };
  }

  const result = await postBankTxnJournal(txnRow, accounts, bizId, overrideMapping, rules);
  return { txnId: txnRow.id, ...result };
}

// Retroactively post a journal entry for a bank transaction that was saved
// without one. `bankAccounts` is the loaded bank_accounts list, used to
// resolve the transaction's business_id (bank_transactions doesn't store it
// directly — it's inherited from the bank account it belongs to).
export async function repostBankTxnJournal(txnRow, accounts, bankAccounts, rules) {
  const acct = (bankAccounts || []).find(b => b.id === txnRow.bank_account_id);
  const bizId = acct?.business_id || null;
  const result = await postBankTxnJournal(txnRow, accounts, bizId, null, rules);
  return { txnId: txnRow.id, ...result };
}

// ── Bank Accounts ──────────────────────────────────────────────────────────────
export async function saveBankAccount(data, id) {
  if (id) {
    const { error } = await supabase.from('bank_accounts').update(data).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('bank_accounts').insert(data);
    if (error) throw error;
  }
}
export async function saveBankTxn(data) {
  const { error } = await supabase.from('bank_transactions').insert(data);
  if (error) throw error;
}
export async function deleteBankTxn(id) {
  const { error } = await supabase.from('bank_transactions').delete().eq('id', id);
  if (error) throw error;
}

// ── Delivery Challans ──────────────────────────────────────────────────────────
export async function saveChallan(challan, items, id) {
  const challanData = {
    business_id: challan.business_id,
    party_id: challan.party_id,
    challan_number: challan.challan_number,
    challan_date: challan.challan_date,
    purpose: challan.purpose,
    vehicle_number: challan.vehicle_number || null,
    transport_mode: challan.transport_mode || null,
    lr_number: challan.lr_number || null,
    driver_name: challan.driver_name || null,
    dispatch_from: challan.dispatch_from || null,
    dispatch_to: challan.dispatch_to || null,
    linked_invoice_id: challan.linked_invoice_id || null,
    notes: challan.notes || null,
    status: challan.status || 'draft',
    subtotal: challan.subtotal,
    cgst_amount: challan.cgst_amount,
    sgst_amount: challan.sgst_amount,
    igst_amount: challan.igst_amount,
    tax_amount: challan.tax_amount,
    total: challan.total,
    is_interstate: challan.is_interstate,
  };

  let cid = id;
  if (id) {
    const { error } = await supabase.from('delivery_challans').update(challanData).eq('id', id);
    if (error) throw new Error(`Challan save failed: ${error.message}`);
    await supabase.from('delivery_challan_items').delete().eq('challan_id', id);
  } else {
    const { data, error } = await supabase.from('delivery_challans').insert(challanData).select().single();
    if (error) throw new Error(`Challan save failed: ${error.message}`);
    cid = data.id;
  }

  if (items?.length) {
    const rows = items.map(it => ({
      challan_id: cid,
      description: it.description,
      hsn_code: it.hsn_code || null,
      unit: it.unit || 'Nos',
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      discount_percent: Number(it.discount_percent || 0),
      tax_percent: Number(it.tax_percent || 0),
      taxable_amount: Number(it.taxable || 0),
      cgst_amount: Number(it.cgst || 0),
      sgst_amount: Number(it.sgst || 0),
      igst_amount: Number(it.igst || 0),
      amount: Number(it.lineTotal || 0),
    }));
    const { error } = await supabase.from('delivery_challan_items').insert(rows);
    if (error) throw new Error(`Challan items save failed: ${error.message}`);
  }
  return cid;
}

export async function getChallanItems(challanId) {
  const { data } = await supabase.from('delivery_challan_items').select('*').eq('challan_id', challanId);
  return data || [];
}

export async function deleteChallan(id) {
  await supabase.from('delivery_challan_items').delete().eq('challan_id', id);
  await supabase.from('delivery_challans').delete().eq('id', id);
}
