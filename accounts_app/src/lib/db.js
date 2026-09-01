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
    if (order) query = query.order(order.column, { ascending: order.ascending !== false });
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
  const [biz, inv, par, exp, pay, accs, jnl, jlines, cns, banks, bankTxns, itms, dcs] = await Promise.all([
    fetchAll('businesses', { order: { column: 'name', ascending: true } }),
    fetchAll('invoices', { order: { column: 'created_at', ascending: false } }),
    fetchAll('parties', { order: { column: 'name', ascending: true } }),
    fetchAll('expenses', { order: { column: 'expense_date', ascending: false } }),
    fetchAll('payments', { order: { column: 'payment_date', ascending: false } }),
    fetchAll('accounts', { order: { column: 'code', ascending: true } }),
    fetchAll('journal_entries', { order: { column: 'entry_date', ascending: false } }),
    fetchAll('journal_lines'),
    fetchAll('credit_notes', { order: { column: 'created_at', ascending: false } }),
    fetchAll('bank_accounts', { order: { column: 'name', ascending: true } }),
    fetchAll('bank_transactions', { order: { column: 'txn_date', ascending: false } }),
    fetchAll('items', { order: { column: 'name', ascending: true } }),
    fetchAll('delivery_challans', { order: { column: 'challan_date', ascending: false } }),
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
  };
}

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
  await supabase.from('invoices').delete().eq('id', id);
}

// ── Payments ───────────────────────────────────────────────────────────────────
export async function savePayment(data) {
  const { error } = await supabase.from('payments').insert(data);
  if (error) throw error;
}
export async function deletePayment(id) { await supabase.from('payments').delete().eq('id', id); }

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
async function postPaymentJournal(payRow, isPurchase) {
  if (!payRow.business_id) return { journalId: null, skipped: true, skipReason: 'no_business_id' };

  const bankAcct = await findAccount(payRow.business_id, 'Bank Account');
  const otherAcct = isPurchase
    ? (await findAccount(payRow.business_id, 'Cost of Goods Sold')) || (await findAccount(payRow.business_id, 'Raw Materials'))
    : await findAccount(payRow.business_id, 'Sales Revenue');
  if (!bankAcct || !otherAcct) return { journalId: null, skipped: true, skipReason: 'account_not_found' };

  const { data: jnl, error: je } = await supabase.from('journal_entries').insert({
    business_id: payRow.business_id,
    entry_date: payRow.payment_date,
    reference: payRow.reference || `PAY-${payRow.id.slice(0, 8)}`,
    description: isPurchase ? `Bill payment${payRow.method ? ' — ' + payRow.method : ''}` : `Payment received${payRow.method ? ' — ' + payRow.method : ''}`,
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

export async function savePaymentWithJournal(data) {
  const isPurchase = data.invoice_type === 'purchase';
  const { invoice_type, ...payRecord } = data; // invoice_type isn't a real payments column
  const { data: payRow, error } = await supabase.from('payments').insert(payRecord).select().single();
  if (error) throw error;

  const result = await postPaymentJournal(payRow, isPurchase);
  return { id: payRow.id, ...result };
}

// Retroactively post a journal entry for a payment that was saved without one
// (e.g. account wasn't set up yet at the time, or it predates the JE-lines
// column-name fix). `invoices` is the loaded invoice list, used to figure out
// whether this was a sale or purchase payment via the linked invoice's type.
export async function repostPaymentJournal(payRow, invoices) {
  const inv = (invoices || []).find(i => i.id === payRow.invoice_id);
  const isPurchase = inv?.type === 'purchase';
  const result = await postPaymentJournal(payRow, isPurchase);
  return { id: payRow.id, ...result };
}

// ── Journal ────────────────────────────────────────────────────────────────────
export async function saveJournal(entry, lines, id) {
  if (id) {
    // Edit mode: update the entry header, then replace all its lines wholesale
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
  await supabase.from('journal_lines').delete().eq('journal_id', id);
  await supabase.from('journal_entries').delete().eq('id', id);
}

// ── Credit Notes ───────────────────────────────────────────────────────────────
export async function saveCreditNote(cn, items) {
  const { data, error } = await supabase.from('credit_notes').insert(cn).select().single();
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

// ── Expenses ───────────────────────────────────────────────────────────────────
export async function saveExpense(data) {
  const { error } = await supabase.from('expenses').insert({ ...data, vendor_id: data.vendor_id || null });
  if (error) throw error;
}
export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
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
  'Job Work': 'Job Work',
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
// ACCOUNT MAPPING RULES (rule engine — no AI needed for known patterns)
// Key = substring to match in txn description (lowercase)
// Value = { debit, credit } account name substrings (looked up in accounts table)
//
const BANK_TXN_RULES = [
  // Credits (money IN) — debit Bank, credit the source account
  { match: ['salary', 'sal credit', 'sal '], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Wages & Salaries' },
  { match: ['refund', 'reversal', 'ref credit'], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Miscellaneous Expenses' },
  { match: ['interest credit', 'int credit', 'int pd'], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Other Income' },
  { match: ['loan', 'borrowing', 'credit facility'], type: 'credit', debitAcct: 'Bank Account', creditAcct: 'Loans & Borrowings' },
  { match: ['capital', 'proprietor', 'owner', 'drawings return'], type: 'credit', debitAcct: 'Bank Account', creditAcct: "Owner's Capital" },
  // Generic credit (customer payment) — debit Bank, credit AR
  // Debits (money OUT) — credit Bank, debit the expense account
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

// Try rule-engine first; return { debitAcct, creditAcct, confidence, method } or null
function applyRuleEngine(txn) {
  const desc = (txn.description + ' ' + (txn.reference || '')).toLowerCase();
  for (const rule of BANK_TXN_RULES) {
    if (rule.type !== txn.type) continue;
    for (const keyword of rule.match) {
      if (desc.includes(keyword)) {
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
async function postBankTxnJournal(txnRow, accounts, bizId, overrideMapping) {
  let mapping = overrideMapping;
  if (!mapping) mapping = applyRuleEngine(txnRow);
  if (!mapping) {
    mapping = txnRow.type === 'credit'
      ? { debitAcct: 'Bank Account', creditAcct: 'Other Income', confidence: 'low', method: 'fallback' }
      : { debitAcct: 'Miscellaneous Expenses', creditAcct: 'Bank Account', confidence: 'low', method: 'fallback' };
  }

  if (!bizId) {
    console.warn('JE skipped: no business_id resolvable for bank txn', txnRow);
    return { journalId: null, mapping, skipped: true, skipReason: 'no_business_id' };
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
export async function saveBankTxnWithJournal(txnData, accounts, bizId) {
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

  const result = await postBankTxnJournal(txnRow, accounts, bizId, overrideMapping);
  return { txnId: txnRow.id, ...result };
}

// Retroactively post a journal entry for a bank transaction that was saved
// without one. `bankAccounts` is the loaded bank_accounts list, used to
// resolve the transaction's business_id (bank_transactions doesn't store it
// directly — it's inherited from the bank account it belongs to).
export async function repostBankTxnJournal(txnRow, accounts, bankAccounts) {
  const acct = (bankAccounts || []).find(b => b.id === txnRow.bank_account_id);
  const bizId = acct?.business_id || null;
  const result = await postBankTxnJournal(txnRow, accounts, bizId, null);
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
