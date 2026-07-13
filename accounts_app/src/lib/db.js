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
  const [biz, inv, par, exp, pay, accs, jnl, jlines, cns, banks, bankTxns, itms, dcs] = await Promise.all([
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
    supabase.from('delivery_challans').select('*').order('challan_date', { ascending: false }),
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
    challans: dcs.data || [],
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

// Auto-post a customer payment → journal entry (Dr Bank Account / Cr Sales Revenue).
// Only call this from a manual entry point (invoice "Record Payment", bulk payment).
// Bank-imported payments already get their journal entry from
// saveBankTxnWithJournal, so BankImport.jsx deliberately keeps calling the
// plain savePayment() above to avoid double-posting the same money in.
export async function savePaymentWithJournal(data) {
  const { data: payRow, error } = await supabase.from('payments').insert(data).select().single();
  if (error) throw error;

  if (!data.business_id) return { id: payRow.id, journalId: null, skipped: true, skipReason: 'no_business_id' };

  const bankAcct = await findAccount(data.business_id, 'Bank Account');
  const salesAcct = await findAccount(data.business_id, 'Sales Revenue');
  if (!bankAcct || !salesAcct) return { id: payRow.id, journalId: null, skipped: true, skipReason: 'account_not_found' };

  const { data: jnl, error: je } = await supabase.from('journal_entries').insert({
    business_id: data.business_id,
    entry_date: data.payment_date,
    reference: data.reference || `PAY-${payRow.id.slice(0, 8)}`,
    description: `Payment received${data.method ? ' — ' + data.method : ''}`,
    narration: data.notes || '',
    source: 'payment',
    source_id: payRow.id,
  }).select().single();
  if (je) return { id: payRow.id, journalId: null, skipped: true, skipReason: je.message };

  const { error: lErr } = await supabase.from('journal_lines').insert([
    { journal_id: jnl.id, account_id: bankAcct.id, type: 'debit', amount: Number(data.amount), narration: data.method || 'Payment received' },
    { journal_id: jnl.id, account_id: salesAcct.id, type: 'credit', amount: Number(data.amount), narration: data.method || 'Payment received' },
  ]);
  if (lErr) return { id: payRow.id, journalId: jnl.id, skipped: true, skipReason: lErr.message };

  return { id: payRow.id, journalId: jnl.id, skipped: false };
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
  if (!expAcct || !cashAcct) return { id: expRow.id, journalId: null, skipped: true, skipReason: 'account_not_found' };

  // 3. Create journal entry (Dr Expense / Cr Bank)
  // NOTE: journal_entries.description is NOT NULL — this was previously omitted,
  // which made this insert fail silently every time (the code below correctly
  // detected the error and bailed out, but nothing ever surfaced it), so no
  // expense has ever actually produced a journal entry until this fix.
  const { data: jnl, error: je } = await supabase.from('journal_entries').insert({
    business_id: data.business_id,
    entry_date: data.expense_date,
    reference: data.reference || `EXP-${expRow.id.slice(0, 8)}`,
    description: `${data.category}${data.description ? ' — ' + data.description : ''}`,
    narration: data.description || '',
    source: 'expense',
    source_id: expRow.id,
  }).select().single();
  if (je) return { id: expRow.id, journalId: null, skipped: true, skipReason: je.message };

  // journal_lines uses type ('debit'|'credit') + amount columns, not debit/credit
  // numeric columns — this mismatch was also silently discarding every line.
  const { error: lErr } = await supabase.from('journal_lines').insert([
    { journal_id: jnl.id, account_id: expAcct.id, type: 'debit', amount: Number(data.amount), narration: data.category },
    { journal_id: jnl.id, account_id: cashAcct.id, type: 'credit', amount: Number(data.amount), narration: data.method || 'Payment' },
  ]);
  if (lErr) return { id: expRow.id, journalId: jnl.id, skipped: true, skipReason: lErr.message };

  return { id: expRow.id, journalId: jnl.id, skipped: false };
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

// Main: save bank transaction + auto-generate journal entry
export async function saveBankTxnWithJournal(txnData, accounts, bizId) {
  // 1. Save bank transaction record
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
      journal_posted: true,
    })
    .select().single();
  if (txnErr) throw txnErr;

  // 2. Determine debit/credit accounts
  // User-edited overrides take priority, then rule engine, then fallback (no AI)
  let mapping;
  if (txnData._overrideDebit && txnData._overrideCredit) {
    mapping = { debitAcct: txnData._overrideDebit, creditAcct: txnData._overrideCredit, confidence: 'high', method: 'user' };
  } else {
    mapping = applyRuleEngine(txnData);
  }
  if (!mapping) {
    mapping = txnData.type === 'credit'
      ? { debitAcct: 'Bank Account', creditAcct: 'Other Income', confidence: 'low', method: 'fallback' }
      : { debitAcct: 'Miscellaneous Expenses', creditAcct: 'Bank Account', confidence: 'low', method: 'fallback' };
  }

  // 3. Look up account IDs by name
  if (!bizId) {
    // This should never happen from the UI now — bank import always scopes to the
    // selected bank account's own business_id — but guard against it explicitly
    // rather than silently filtering accounts down to an empty list.
    console.warn('JE skipped: no business_id provided to saveBankTxnWithJournal', txnData);
    return { txnId: txnRow.id, journalId: null, mapping, skipped: true, skipReason: 'no_business_id' };
  }
  const bizAccounts = accounts.filter(a => a.business_id === bizId);
  const findAcct = (name) => bizAccounts.find(a =>
    a.name.toLowerCase().includes(name.toLowerCase()) ||
    name.toLowerCase().includes(a.name.toLowerCase())
  );

  const debitAcct = findAcct(mapping.debitAcct);
  const creditAcct = findAcct(mapping.creditAcct);

  if (!debitAcct || !creditAcct) {
    // Accounts not set up — save txn only, skip journal
    console.warn('JE skipped: account not found', mapping, 'missing:', !debitAcct ? mapping.debitAcct : mapping.creditAcct);
    return { txnId: txnRow.id, journalId: null, mapping, skipped: true, skipReason: 'account_not_found' };
  }

  // 4. Create journal entry header
  // NOTE: journal_entries.description is NOT NULL — it was missing here, which
  // made this insert fail every single time. The catch in BankImport.jsx/
  // BulkImport.jsx logged it to console and moved on, so transactions kept
  // getting marked "posted" while silently never producing a journal entry.
  const { data: jnl, error: jErr } = await supabase
    .from('journal_entries')
    .insert({
      business_id: bizId,
      entry_date: txnData.date,
      reference: txnData.reference || `BANK-${txnRow.id.slice(0, 8)}`,
      description: mapping.reason || txnData.description || 'Bank transaction',
      narration: txnData.description,
      source: 'bank_import',
      source_id: txnRow.id,
    })
    .select().single();
  if (jErr) throw jErr;

  // 5. Create debit + credit journal lines
  // journal_lines uses type ('debit'|'credit') + amount columns, not separate
  // debit/credit numeric columns — this mismatch silently discarded every line
  // insert (Postgres rejects unknown columns), which is the other half of why
  // no journal lines ever actually landed for bank-imported transactions.
  const { error: lErr } = await supabase.from('journal_lines').insert([
    {
      journal_id: jnl.id,
      account_id: debitAcct.id,
      type: 'debit',
      amount: txnData.amount,
      narration: mapping.reason || txnData.description,
    },
    {
      journal_id: jnl.id,
      account_id: creditAcct.id,
      type: 'credit',
      amount: txnData.amount,
      narration: mapping.reason || txnData.description,
    },
  ]);
  if (lErr) throw lErr;

  return { txnId: txnRow.id, journalId: jnl.id, mapping, skipped: false };
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
