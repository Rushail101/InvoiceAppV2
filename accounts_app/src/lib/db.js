// db.js — all Supabase queries in one place

export let supabase = null;

export function initSupabase(client) { supabase = client; }

// ── Generic ────────────────────────────────────────────────────────────────────
async function q(table, method, ...args) {
  const { data, error } = await supabase.from(table)[method](...args);
  if (error) throw error;
  return data;
}

// ── Load all data ──────────────────────────────────────────────────────────────
export async function loadAll() {
  const [biz, inv, par, exp, pay, accs, jnl, jlines, cns, banks, bankTxns, itms] = await Promise.all([
    supabase.from('businesses').select('*').order('name'),
    supabase.from('invoices').select('*').order('created_at', { ascending: false }),
    supabase.from('parties').select('*').order('name'),
    supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
    supabase.from('payments').select('*').order('payment_date', { ascending: false }),
    supabase.from('accounts').select('*').order('code'),
    supabase.from('journal_entries').select('*').order('entry_date', { ascending: false }),
    supabase.from('journal_lines').select('*'),
    supabase.from('credit_notes').select('*').order('created_at', { ascending: false }),
    supabase.from('bank_accounts').select('*').order('name'),
    supabase.from('bank_transactions').select('*').order('txn_date', { ascending: false }),
    supabase.from('items').select('*').order('name'),
  ]);
  return {
    businesses: biz.data || [],
    invoices: inv.data || [],
    parties: par.data || [],
    expenses: exp.data || [],
    payments: pay.data || [],
    accounts: accs.data || [],
    journalEntries: jnl.data || [],
    journalLines: jlines.data || [],
    creditNotes: cns.data || [],
    bankAccounts: banks.data || [],
    bankTransactions: bankTxns.data || [],
    items: itms.data || [],
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

// ── Invoices ───────────────────────────────────────────────────────────────────
// Safe column list — only fields that exist in the DB schema
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
  return rid;
}

export async function getInvoiceItems(invoiceId) {
  const { data } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId);
  return data || [];
}

export async function updateInvoiceStatus(id, status) {
  await supabase.from('invoices').update({ status }).eq('id', id);
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

// ── Journal ────────────────────────────────────────────────────────────────────
export async function saveJournal(entry, lines) {
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

const CATEGORY_ACCOUNT_MAP = {
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

export async function saveExpenseWithJournal(data) {
  // 1. Save expense
  const { data: expRow, error } = await supabase.from('expenses')
    .insert({ ...data, vendor_id: data.vendor_id || null, journal_posted: true })
    .select().single();
  if (error) throw error;

  // 2. Find expense account (by category mapping)
  const acctName = CATEGORY_ACCOUNT_MAP[data.category] || 'Miscellaneous';
  const expAcct = await findAccount(data.business_id, acctName);
  const cashAcct = await findAccount(data.business_id, 'Bank Account') ||
                   await findAccount(data.business_id, 'Cash');
  if (!expAcct || !cashAcct) return expRow.id; // skip journal if accounts not set up

  // 3. Create journal entry (Dr Expense / Cr Bank)
  const { data: jnl, error: je } = await supabase.from('journal_entries').insert({
    business_id: data.business_id,
    entry_date: data.expense_date,
    reference: data.reference || `EXP-${expRow.id.slice(0,8)}`,
    narration: `${data.category}${data.description ? ' — ' + data.description : ''}`,
    source: 'expense',
    source_id: expRow.id,
  }).select().single();
  if (je) return expRow.id;

  await supabase.from('journal_lines').insert([
    { journal_id: jnl.id, account_id: expAcct.id, debit: Number(data.amount), credit: 0, narration: data.category },
    { journal_id: jnl.id, account_id: cashAcct.id, debit: 0, credit: Number(data.amount), narration: data.method || 'Payment' },
  ]);
  return expRow.id;
}

export async function backfillExpenseJournals(bizId) {
  // Get all expenses for this business
  const { data: expenses } = await supabase.from('expenses')
    .select('*').eq('business_id', bizId);
  if (!expenses?.length) return { count: 0, skipped: 0, reason: null };

  // Check accounts exist at all
  const { data: allAccts } = await supabase.from('accounts').select('*').eq('business_id', bizId);
  if (!allAccts?.length) {
    return { count: 0, skipped: expenses.length, reason: 'no_accounts' };
  }

  // Get all existing journal entries with source tracking
  const { data: existingJnls } = await supabase.from('journal_entries')
    .select('source_id, entry_date, narration').eq('business_id', bizId).eq('source', 'expense');

  const postedBySourceId = new Set((existingJnls || []).filter(j => j.source_id).map(j => j.source_id));
  const postedByNarration = new Set((existingJnls || []).map(j => `${j.entry_date}|${j.narration}`));

  // Find cash/bank account — try multiple name patterns
  const cashAcct = allAccts.find(a => /bank account/i.test(a.name)) ||
                   allAccts.find(a => /cash/i.test(a.name)) ||
                   allAccts.find(a => a.group === 'asset' && /current/i.test(a.sub_group || ''));

  if (!cashAcct) return { count: 0, skipped: expenses.length, reason: 'no_cash_account' };

  let count = 0, skipped = 0;
  for (const exp of expenses) {
    if (postedBySourceId.has(exp.id)) { skipped++; continue; }

    const narration = `${exp.category}${exp.description ? ' — ' + exp.description : ''}`;
    if (postedByNarration.has(`${exp.expense_date}|${narration}`)) { skipped++; continue; }

    // Find best matching expense account
    const acctName = CATEGORY_ACCOUNT_MAP[exp.category] || 'Miscellaneous';
    const expAcct = allAccts.find(a => new RegExp(acctName, 'i').test(a.name)) ||
                    allAccts.find(a => /miscellaneous/i.test(a.name)) ||
                    allAccts.find(a => a.group === 'expense');

    if (!expAcct) { skipped++; continue; }

    const { data: jnl, error: je } = await supabase.from('journal_entries').insert({
      business_id: bizId,
      entry_date: exp.expense_date,
      reference: exp.reference || `EXP-${exp.id.slice(0, 8)}`,
      narration,
      source: 'expense',
      source_id: exp.id,
    }).select().single();
    if (je) { skipped++; continue; }

    await supabase.from('journal_lines').insert([
      { journal_id: jnl.id, account_id: expAcct.id, debit: Number(exp.amount), credit: 0, narration: exp.category },
      { journal_id: jnl.id, account_id: cashAcct.id, debit: 0, credit: Number(exp.amount), narration: exp.method || 'Payment' },
    ]);
    await supabase.from('expenses').update({ journal_posted: true }).eq('id', exp.id);
    count++;
  }
  return { count, skipped, reason: null };
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
