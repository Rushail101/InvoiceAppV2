// src/lib/db.js — all Supabase queries in one place

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
  const [biz, inv, par, exp, pay, accs, jnl, jlines, cns, banks, bankTxns, itms, dcs] = await Promise.all([
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

// Flexible account resolver: handles names, aliases, and lowercase variations
export async function findAccount(bizId, nameOrPattern) {
  if (!bizId || !nameOrPattern) return null;
  const q = nameOrPattern.trim().toLowerCase();
  const { data: accounts } = await supabase
    .from('accounts')
    .select('*')
    .eq('business_id', bizId);
  if (!accounts || !accounts.length) return null;

  // Exact match first
  let matched = accounts.find(a => a.name.toLowerCase() === q);
  if (matched) return matched;

  // Pattern aliases
  if (q.includes('receivable') || q.includes('debtor')) {
    matched = accounts.find(a => a.name.toLowerCase().includes('receivable') || a.name.toLowerCase().includes('debtor'));
  } else if (q.includes('payable') && !q.includes('gst')) {
    matched = accounts.find(a => a.name.toLowerCase().includes('payable') || a.name.toLowerCase().includes('creditor'));
  } else if (q.includes('bank')) {
    matched = accounts.find(a => a.name.toLowerCase().includes('bank'));
  } else if (q.includes('advance')) {
    matched = accounts.find(a => a.name.toLowerCase().includes('advance'));
  } else if (q.includes('sales') || q.includes('revenue')) {
    matched = accounts.find(a => a.name.toLowerCase().includes('sales') || a.name.toLowerCase().includes('revenue'));
  } else {
    matched = accounts.find(a => a.name.toLowerCase().includes(q));
  }
  return matched || null;
}

// ── Invoices ───────────────────────────────────────────────────────────────────
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

  // Automatic Sales Accrual
  // When an invoice is an active tax sale, book:
  // Dr: Accounts Receivable (Total)
  //   Cr: Sales Revenue (Subtotal)
  //   Cr: GST Payables (Taxes)
  if (inv.type === 'sale' && !['draft', 'proforma', 'cancelled'].includes(inv.status)) {
    postInvoiceAccrualJournal({ ...invData, id: rid }).catch(err => {
      console.error('Auto-accrual entry failed:', err);
    });
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

export async function markGSTFiled(ids, filed = true, period = null) {
  if (!ids?.length) return;
  const payload = filed
    ? { gst_filed: true, gst_filed_at: new Date().toISOString(), gst_filed_period: period }
    : { gst_filed: false, gst_filed_at: null, gst_filed_period: null };
  const { error } = await supabase.from('invoices').update(payload).in('id', ids);
  if (error) throw new Error(`GST filed update failed: ${error.message}`);
}

export async function deleteInvoice(id) {
  // Clear any linked automatic journal entry
  await supabase.from('journal_entries').delete().eq('source', 'invoice').eq('source_id', id);
  await supabase.from('invoices').delete().eq('id', id);
}

// ── Auto Accrual Engine ────────────────────────────────────────────────────────
export async function postInvoiceAccrualJournal(invoice) {
  if (!invoice.business_id) return;
  const arAcct = (await findAccount(invoice.business_id, 'Accounts Receivable')) || (await findAccount(invoice.business_id, 'Sundry Debtors'));
  const salesAcct = await findAccount(invoice.business_id, 'Sales Revenue');
  const cgstAcct = await findAccount(invoice.business_id, 'Output CGST') || await findAccount(invoice.business_id, 'CGST Payable');
  const sgstAcct = await findAccount(invoice.business_id, 'Output SGST') || await findAccount(invoice.business_id, 'SGST Payable');
  const igstAcct = await findAccount(invoice.business_id, 'Output IGST') || await findAccount(invoice.business_id, 'IGST Payable');

  if (!arAcct || !salesAcct) {
    console.warn('Accounts Receivable or Sales Revenue ledger missing. Skipping auto-accrual.');
    return;
  }

  // Remove existing auto-entry if updating
  const { data: existingJE } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('source', 'invoice')
    .eq('source_id', invoice.id)
    .maybeSingle();

  if (existingJE) await deleteJournal(existingJE.id);

  const lines = [
    {
      account_id: arAcct.id,
      type: 'debit',
      amount: Number(invoice.total),
      narration: `Accrual for Inv #${invoice.invoice_number}`,
    },
    {
      account_id: salesAcct.id,
      type: 'credit',
      amount: Number(invoice.subtotal),
      narration: `Sales value for Inv #${invoice.invoice_number}`,
    },
  ];

  if (Number(invoice.cgst_amount) > 0 && cgstAcct) {
    lines.push({ account_id: cgstAcct.id, type: 'credit', amount: Number(invoice.cgst_amount), narration: 'Output CGST' });
  }
  if (Number(invoice.sgst_amount) > 0 && sgstAcct) {
    lines.push({ account_id: sgstAcct.id, type: 'credit', amount: Number(invoice.sgst_amount), narration: 'Output SGST' });
  }
  if (Number(invoice.igst_amount) > 0 && igstAcct) {
    lines.push({ account_id: igstAcct.id, type: 'credit', amount: Number(invoice.igst_amount), narration: 'Output IGST' });
  }

  const entry = {
    business_id: invoice.business_id,
    entry_date: invoice.issue_date,
    reference: invoice.invoice_number,
    description: `Sales Accrual — ${invoice.invoice_number}`,
    narration: invoice.notes || '',
    source: 'invoice',
    source_id: invoice.id,
  };

  await saveJournal(entry, lines);
}

// ── Payments & Settlement ──────────────────────────────────────────────────────
export async function savePayment(data) {
  const { error } = await supabase.from('payments').insert(data);
  if (error) throw error;
}
export async function deletePayment(id) {
  await supabase.from('journal_entries').delete().eq('source', 'payment').eq('source_id', id);
  await supabase.from('payments').delete().eq('id', id);
}

// Auto-post payment settlements:
// Customer Payments: Dr Bank / Cr Accounts Receivable (or Advance from Customers if proforma)
// Vendor Payments:   Dr Cost of Goods Sold / Cr Bank
async function postPaymentJournal(payRow, isPurchase) {
  if (!payRow.business_id) return { journalId: null, skipped: true, skipReason: 'no_business_id' };

  let linkedInv = null;
  if (payRow.invoice_id) {
    const { data: inv } = await supabase.from('invoices').select('*').eq('id', payRow.invoice_id).maybeSingle();
    linkedInv = inv;
  }

  const bankAcct = await findAccount(payRow.business_id, 'Bank Account');
  let otherAcct = null;

  if (isPurchase) {
    otherAcct = (await findAccount(payRow.business_id, 'Cost of Goods Sold')) || (await findAccount(payRow.business_id, 'Raw Materials'));
  } else {
    // If receiving against a proforma, route to Advance from Customers liability
    if (linkedInv?.status === 'proforma') {
      otherAcct = (await findAccount(payRow.business_id, 'Advance from Customers')) || (await findAccount(payRow.business_id, 'Accounts Receivable'));
    } else {
      // Standard settlement: credit Accounts Receivable to decrease what the client owes
      otherAcct = (await findAccount(payRow.business_id, 'Accounts Receivable'))
        || (await findAccount(payRow.business_id, 'Sundry Debtors'))
        || (await findAccount(payRow.business_id, 'Sales Revenue')); // fallback
    }
  }

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

  const isAdvance = linkedInv?.status === 'proforma';
  const creditNarration = isPurchase
    ? (payRow.method || 'Bill payment')
    : (isAdvance ? `Advance for Proforma ${linkedInv?.invoice_number || ''}` : `Settlement of ${linkedInv?.invoice_number || 'invoice'}`);

  const lines = isPurchase
    ? [
        { journal_id: jnl.id, account_id: otherAcct.id, type: 'debit', amount: Number(payRow.amount), narration: payRow.method || 'Bill payment' },
        { journal_id: jnl.id, account_id: bankAcct.id, type: 'credit', amount: Number(payRow.amount), narration: payRow.method || 'Bill payment' },
      ]
    : [
        { journal_id: jnl.id, account_id: bankAcct.id, type: 'debit', amount: Number(payRow.amount), narration: payRow.method || 'Payment received' },
        { journal_id: jnl.id, account_id: otherAcct.id, type: 'credit', amount: Number(payRow.amount), narration: creditNarration },
      ];

  const { error: lErr } = await supabase.from('journal_lines').insert(lines);
  if (lErr) return { journalId: jnl.id, skipped: true, skipReason: lErr.message };

  return { journalId: jnl.id, skipped: false };
}

export async function savePaymentWithJournal(data) {
  const isPurchase = data.invoice_type === 'purchase';
  const { invoice_type, ...payRecord } = data;
  const { data: payRow, error } = await supabase.from('payments').insert(payRecord).select().single();
  if (error) throw error;

  const result = await postPaymentJournal(payRow, isPurchase);
  return { id: payRow.id, ...result };
}

export async function repostPaymentJournal(payRow, invoices) {
  const inv = (invoices || []).find(i => i.id === payRow.invoice_id);
  const isPurchase = inv?.type === 'purchase';
  const result = await postPaymentJournal(payRow, isPurchase);
  return { id: payRow.id, ...result };
}

// ── Bank Transactions (Bank Import & Bulk Import) ──────────────────────────────
export async function saveBankTxnWithJournal(txn, accounts, businessId) {
  const { data: bTxn, error: bErr } = await supabase
    .from('bank_transactions')
    .insert({
      bank_account_id: txn.bankAccountId,
      business_id: businessId,
      txn_date: txn.date,
      description: txn.description,
      reference: txn.reference || null,
      type: txn.type,
      amount: Number(txn.amount),
      balance: txn.balance != null ? Number(txn.balance) : null,
      party_id: txn.partyId || null,
    })
    .select()
    .single();

  if (bErr) throw bErr;

  const bizAccounts = (accounts || []).filter(a => a.business_id === businessId);
  const debitName = txn._overrideDebit || txn.je?.debitAcct || txn.cls?.dr;
  const creditName = txn._overrideCredit || txn.je?.creditAcct || txn.cls?.cr;

  const drAcct = bizAccounts.find(a => a.name.toLowerCase() === (debitName || '').toLowerCase());
  const crAcct = bizAccounts.find(a => a.name.toLowerCase() === (creditName || '').toLowerCase());

  if (!drAcct || !crAcct) {
    return { bankTxnId: bTxn.id, journalId: null, skipped: true, reason: 'Account mapping not found in Chart of Accounts' };
  }

  const lines = [
    { account_id: drAcct.id, type: 'debit', amount: Number(txn.amount), narration: txn.description },
    { account_id: crAcct.id, type: 'credit', amount: Number(txn.amount), narration: txn.description },
  ];

  const entry = {
    business_id: businessId,
    entry_date: txn.date,
    reference: txn.reference || `BNK-${bTxn.id.slice(0, 8)}`,
    description: txn.description || 'Bank transaction',
    source: 'bank_import',
    source_id: bTxn.id,
  };

  const jid = await saveJournal(entry, lines);
  return { bankTxnId: bTxn.id, journalId: jid, mapping: { debitAcct: drAcct.name, creditAcct: crAcct.name } };
}

// ── Journal ────────────────────────────────────────────────────────────────────
export async function saveJournal(entry, lines, id) {
  if (id) {
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

// ── Delivery Challans ──────────────────────────────────────────────────────────
export async function getChallanItems(challanId) {
  const { data, error } = await supabase.from('delivery_challan_items').select('*').eq('challan_id', challanId);
  if (error) throw error;
  return data || [];
}

export async function saveChallan(challanData, items, id) {
  let challanId = id;
  if (id) {
    const { error: cErr } = await supabase.from('delivery_challans').update(challanData).eq('id', id);
    if (cErr) throw cErr;
    const { error: dErr } = await supabase.from('delivery_challan_items').delete().eq('challan_id', id);
    if (dErr) throw dErr;
  } else {
    const { data: newChallan, error: cErr } = await supabase.from('delivery_challans').insert(challanData).select().single();
    if (cErr) throw cErr;
    challanId = newChallan.id;
  }

  if (items && items.length) {
    const itemRows = items.map(it => ({
      challan_id: challanId,
      description: it.description,
      hsn_code: it.hsn_code || null,
      unit: it.unit || 'Nos',
      quantity: Number(it.quantity) || 1,
      unit_price: Number(it.unit_price) || 0,
      discount_percent: Number(it.discount_percent) || 0,
      tax_percent: Number(it.tax_percent) || 0,
      taxable_amount: Number(it.taxable) || 0,
      cgst_amount: Number(it.cgst) || 0,
      sgst_amount: Number(it.sgst) || 0,
      igst_amount: Number(it.igst) || 0,
      amount: Number(it.lineTotal) || 0,
    }));
    const { error: itErr } = await supabase.from('delivery_challan_items').insert(itemRows);
    if (itErr) throw itErr;
  }

  return challanId;
}

export async function deleteChallan(id) {
  await supabase.from('delivery_challan_items').delete().eq('challan_id', id);
  const { error } = await supabase.from('delivery_challans').delete().eq('id', id);
  if (error) throw error;
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
