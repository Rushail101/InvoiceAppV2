// lib/tally.js — Expense / Payment ↔ Journal "Tally" check
//
// JournalHealth.jsx already checks whether a journal entry EXISTS for a
// given expense/payment (by source/source_id). This is a step further: it
// checks whether the journal entry that exists actually agrees with the
// record — same date, same amount. A journal entry can exist but drift
// from the source row if the expense/payment was edited after posting, or
// the journal entry was hand-edited. That drift is invisible to Journal
// Health but is exactly the kind of thing that causes a GST filing or a
// payment to quietly go missing from reports.
//
// Used by the "🔎 Tally" button on the Expenses and Payments pages.

const AMT_TOL = 0.5; // paise/rounding tolerance
const AUTO_IMPORT_NOTE = 'Auto-imported from bank statement';

// A journal entry is always balanced (debit total === credit total), so
// summing either side gives the entry's amount.
export function jeAmount(je, journalLines) {
  return journalLines
    .filter(l => l.journal_id === je.id && l.type === 'debit')
    .reduce((s, l) => s + Number(l.amount), 0);
}

function compare(recordDate, recordAmount, je, journalLines, via) {
  const jeAmt = jeAmount(je, journalLines);
  const dateOk = je.entry_date === recordDate;
  const amtOk = Math.abs(jeAmt - Number(recordAmount)) <= AMT_TOL;

  if (dateOk && amtOk) return { status: 'matched', journal: je, via };

  const parts = [];
  if (!dateOk) parts.push(`journal dated ${je.entry_date}, record dated ${recordDate}`);
  if (!amtOk) parts.push(`journal amount ₹${jeAmt.toFixed(2)}, record amount ₹${Number(recordAmount).toFixed(2)}`);
  return { status: 'mismatch', reason: parts.join(' · '), journal: je, via };
}

export function tallyExpense(expense, journalEntries, journalLines) {
  const je = journalEntries.find(j => j.source === 'expense' && j.source_id === expense.id);
  if (!je) return { status: 'missing', reason: 'No journal entry found for this expense' };
  return compare(expense.expense_date, expense.amount, je, journalLines, 'expense');
}

export function tallyPayment(payment, journalEntries, journalLines) {
  const je = journalEntries.find(j => j.source === 'payment' && j.source_id === payment.id);
  if (je) return compare(payment.payment_date, payment.amount, je, journalLines, 'payment');

  // Bank-imported payments deliberately never get their own journal entry
  // (see BankImport.jsx / saveBankTxnWithJournal) — the money was already
  // posted via the bank transaction's own entry, source='bank_import'.
  // Fall back to matching by date + amount against those so these don't
  // show up as false "missing" every time.
  if (payment.notes === AUTO_IMPORT_NOTE) {
    const candidate = journalEntries.find(j =>
      j.source === 'bank_import' &&
      j.entry_date === payment.payment_date &&
      Math.abs(jeAmount(j, journalLines) - Number(payment.amount)) <= AMT_TOL
    );
    if (candidate) return { status: 'matched', journal: candidate, via: 'bank_import' };
    return { status: 'missing', reason: 'Auto-imported payment — no matching bank-import journal entry found' };
  }

  return { status: 'missing', reason: 'No journal entry found for this payment' };
}

export function tallySummary(resultsById) {
  const results = Object.values(resultsById);
  return {
    matched: results.filter(r => r.status === 'matched').length,
    mismatch: results.filter(r => r.status === 'mismatch').length,
    missing: results.filter(r => r.status === 'missing').length,
    total: results.length,
  };
}

// ── Duplicate detection ─────────────────────────────────────────────────────
//
// Different problem from the tally checks above: those confirm an
// *already-saved* record still matches its journal entry. This instead runs
// BEFORE saving, to catch a second expense/journal entry that's really the
// same transaction entered twice. Used by ExpenseModal and JournalModal.

// Journal: an entry on the same date, for the same business, is flagged as a
// likely duplicate of the one being saved if EITHER its description matches
// OR its total amount matches. Either signal alone is enough to warn on —
// a duplicate is often re-typed with a slightly different description but
// the same numbers, or copy-pasted (same description) and then the amount
// gets edited. Requiring both at once (the old check effectively required
// description alone) misses too many real duplicates.
export function findDuplicateJournalEntry(candidate, allEntries, journalLines, excludeId) {
  const candDesc = (candidate.description || '').trim().toLowerCase();
  const candAmt = Number(candidate.totalAmount) || 0;
  return allEntries.find(e => {
    if (excludeId && e.id === excludeId) return false;
    if (e.business_id !== candidate.business_id) return false;
    if (e.entry_date !== candidate.entry_date) return false;
    const sameDesc = !!candDesc && (e.description || '').trim().toLowerCase() === candDesc;
    const sameAmt = candAmt > 0 && Math.abs(jeAmount(e, journalLines) - candAmt) <= AMT_TOL;
    return sameDesc || sameAmt;
  }) || null;
}

// Expenses: same business, same date, same category, same vendor (or both
// blank), same amount. That combination essentially never happens twice on
// purpose, so it's a strong enough signal to flag on its own without
// needing to also match the free-text description.
export function findDuplicateExpense(candidate, allExpenses, excludeId) {
  const candAmt = Number(candidate.amount) || 0;
  return allExpenses.find(e => {
    if (excludeId && e.id === excludeId) return false;
    if (e.business_id !== candidate.business_id) return false;
    if (e.expense_date !== candidate.expense_date) return false;
    if ((e.category || '') !== (candidate.category || '')) return false;
    if ((e.vendor_id || null) !== (candidate.vendor_id || null)) return false;
    return Math.abs(Number(e.amount) - candAmt) <= AMT_TOL;
  }) || null;
}
