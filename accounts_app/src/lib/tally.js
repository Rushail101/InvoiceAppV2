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
function jeAmount(je, journalLines) {
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
