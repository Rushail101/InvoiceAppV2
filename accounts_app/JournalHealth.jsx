// JournalHealth.jsx — Journal Posting Health
//
// The Analysis tab, Trial Balance, and P&L all read from journal_entries /
// journal_lines, not from the raw payments/expenses/bank_transactions tables.
// That's correct — but it means any payment, expense, or bank transaction
// that never got its journal entry (missing Chart of Accounts entry at the
// time, a past bug in the posting code, etc) is invisible to those reports
// even though the money is real and sitting in its own table. This view
// finds those gaps by checking directly against journal_entries.source /
// source_id — not against the journal_posted flags, which historically
// could be wrong — and lets you re-post them once the underlying issue
// (usually a missing account) is fixed.
import { useState, useMemo } from 'react';
import { fmt, fmtDate } from '../lib/constants.js';
import { EmptyState, StatCard } from '../components/ui.jsx';
import { repostExpenseJournal, repostPaymentJournal, repostBankTxnJournal } from '../lib/db.js';
import { tallyExpense, tallyPayment } from '../lib/tally.js';

const AUTO_IMPORT_NOTE = 'Auto-imported from bank statement';

const REASON_LABEL = {
  account_not_found: 'Missing account in Chart of Accounts',
  no_business_id: 'No business linked',
};

function reasonText(r) {
  if (!r) return '';
  return REASON_LABEL[r] || r;
}

export function JournalHealthView({
  expenses, payments, bankTransactions, journalEntries, journalLines = [], invoices, accounts, bankAccounts,
  businesses, activeBiz, reload,
}) {
  const [busyId, setBusyId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [results, setResults] = useState(null); // { fixed, stillSkipped, reasons }

  const scoped = (list) => activeBiz ? list.filter(x => x.business_id === activeBiz) : list;

  // "Missing" here means the same thing the Tally check on the Expenses/
  // Payments pages means — not just "no journal entry formally linked by
  // source_id", but genuinely no journal entry representing this money at
  // all. A formally-linked entry is the normal case, but plenty of records
  // are instead covered by a manually-entered Journal Voucher for the same
  // date/amount/account (see tallyExpense's fallback) — those are already
  // accounted for and must NOT show up here, because clicking Re-post on
  // one would create a second journal entry for money that's already
  // posted once.
  const orphanExpenses = useMemo(() => {
    return scoped(expenses).filter(e => tallyExpense(e, journalEntries, journalLines, accounts).status === 'missing');
  }, [expenses, activeBiz, journalEntries, journalLines, accounts]);

  const orphanPayments = useMemo(() => {
    return scoped(payments).filter(p => p.notes !== AUTO_IMPORT_NOTE && tallyPayment(p, journalEntries, journalLines).status === 'missing');
  }, [payments, activeBiz, journalEntries, journalLines]);

  const orphanBankTxns = useMemo(() => {
    const bizBankAccountIds = new Set(
      (activeBiz ? bankAccounts.filter(b => b.business_id === activeBiz) : bankAccounts).map(b => b.id)
    );
    const postedKeys = new Set(journalEntries.map(je => `${je.source}:${je.source_id}`));
    return bankTransactions.filter(t => bizBankAccountIds.has(t.bank_account_id) && !postedKeys.has(`bank_import:${t.id}`));
  }, [bankTransactions, bankAccounts, activeBiz, journalEntries]);

  const totalOrphans = orphanExpenses.length + orphanPayments.length + orphanBankTxns.length;
  const totalOrphanAmount =
    orphanExpenses.reduce((s, e) => s + Number(e.amount), 0) +
    orphanPayments.reduce((s, p) => s + Number(p.amount), 0) +
    orphanBankTxns.reduce((s, t) => s + Number(t.amount), 0);

  async function repostOne(kind, row) {
    setBusyId(row.id);
    try {
      let res;
      if (kind === 'expense') res = await repostExpenseJournal(row);
      else if (kind === 'payment') res = await repostPaymentJournal(row, invoices);
      else res = await repostBankTxnJournal(row, accounts, bankAccounts);
      if (res.skipped) alert(`Still couldn't post: ${reasonText(res.skipReason)}`);
      await reload();
    } catch (e) {
      alert(e.message || 'Re-post failed');
    }
    setBusyId(null);
  }

  async function repostAll() {
    if (!totalOrphans) return;
    if (!confirm(`Attempt to post journal entries for ${totalOrphans} record(s)? Anything still missing an account will be left as-is.`)) return;
    setBulkBusy(true);
    setResults(null);
    let fixed = 0, stillSkipped = 0;
    const reasons = {};
    for (const e of orphanExpenses) {
      const res = await repostExpenseJournal(e);
      if (res.skipped) { stillSkipped++; reasons[reasonText(res.skipReason)] = (reasons[reasonText(res.skipReason)] || 0) + 1; }
      else fixed++;
    }
    for (const p of orphanPayments) {
      const res = await repostPaymentJournal(p, invoices);
      if (res.skipped) { stillSkipped++; reasons[reasonText(res.skipReason)] = (reasons[reasonText(res.skipReason)] || 0) + 1; }
      else fixed++;
    }
    for (const t of orphanBankTxns) {
      const res = await repostBankTxnJournal(t, accounts, bankAccounts);
      if (res.skipped) { stillSkipped++; reasons[reasonText(res.skipReason)] = (reasons[reasonText(res.skipReason)] || 0) + 1; }
      else fixed++;
    }
    setResults({ fixed, stillSkipped, reasons });
    setBulkBusy(false);
    await reload();
  }

  return (
    <div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 14 }}>
        <StatCard label="Unposted Records" value={totalOrphans} color={totalOrphans ? 'red' : 'green'}
          sub="Missing from Analysis / P&L / Trial Balance" />
        <StatCard label="Amount Affected" value={fmt(totalOrphanAmount)} color={totalOrphans ? 'amber' : 'green'} />
        <StatCard label="Orphan Expenses" value={orphanExpenses.length} color="red" />
        <StatCard label="Orphan Payments + Bank Txns" value={orphanPayments.length + orphanBankTxns.length} color="red" />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">What this checks</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
          Analysis, Trial Balance, P&L, and Balance Sheet all total up <strong style={{ color: 'var(--text)' }}>journal entries</strong>,
          not the raw Expenses / Payments / Bank tables directly. A record ends up here only if there's genuinely no journal
          entry for it anywhere — usually because a required account (e.g. "Cost of Goods Sold", "Wages & Salaries")
          didn't exist in the Chart of Accounts at the time it was saved. A record covered by a manually-entered Journal
          Voucher for the same date/amount/account is <em>not</em> shown here, even without a formal link — Re-posting it
          would create a duplicate. Until it's posted, it's real money that won't show up in any of those reports.
        </p>
        {totalOrphans > 0 && (
          <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={repostAll} disabled={bulkBusy}>
            {bulkBusy ? 'Posting…' : `⚡ Re-post All ${totalOrphans}`}
          </button>
        )}
        {results && (
          <p style={{ fontSize: 12, marginTop: 10, color: 'var(--text2)' }}>
            Posted {results.fixed}. {results.stillSkipped > 0 && (
              <>Still missing {results.stillSkipped} — {Object.entries(results.reasons).map(([r, n]) => `${r} (${n})`).join(', ')}.
              Add the missing account(s) in Chart of Accounts, then come back and re-post.</>
            )}
          </p>
        )}
      </div>

      <OrphanSection
        title="Expenses without a journal entry"
        icon="💸"
        rows={orphanExpenses}
        columns={['Date', 'Category', 'Description', 'Amount']}
        renderRow={(e) => (
          <>
            <td className="mono" style={{ fontSize: 11 }}>{fmtDate(e.expense_date)}</td>
            <td style={{ fontSize: 12 }}>{e.category}</td>
            <td style={{ fontSize: 11, color: 'var(--text2)' }}>{e.description || '—'}</td>
            <td className="r mono" style={{ color: 'var(--red)' }}>{fmt(e.amount)}</td>
          </>
        )}
        onRepost={(row) => repostOne('expense', row)}
        busyId={busyId}
      />

      <OrphanSection
        title="Payments without a journal entry"
        icon="💳"
        rows={orphanPayments}
        columns={['Date', 'Method', 'Reference', 'Amount']}
        renderRow={(p) => (
          <>
            <td className="mono" style={{ fontSize: 11 }}>{fmtDate(p.payment_date)}</td>
            <td className="mono" style={{ fontSize: 11 }}>{p.method}</td>
            <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{p.reference || '—'}</td>
            <td className="r mono" style={{ color: 'var(--green)' }}>{fmt(p.amount)}</td>
          </>
        )}
        onRepost={(row) => repostOne('payment', row)}
        busyId={busyId}
      />

      <OrphanSection
        title="Bank transactions without a journal entry"
        icon="🏦"
        rows={orphanBankTxns}
        columns={['Date', 'Description', 'Type', 'Amount']}
        renderRow={(t) => (
          <>
            <td className="mono" style={{ fontSize: 11 }}>{fmtDate(t.txn_date)}</td>
            <td style={{ fontSize: 11, color: 'var(--text2)' }}>{t.description || '—'}</td>
            <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{t.type}</td>
            <td className="r mono">{fmt(t.amount)}</td>
          </>
        )}
        onRepost={(row) => repostOne('bank', row)}
        busyId={busyId}
      />
    </div>
  );
}

function OrphanSection({ title, icon, rows, columns, renderRow, onRepost, busyId }) {
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {icon} {title} ({rows.length})
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map(c => <th key={c} className={c === 'Amount' ? 'r' : ''}>{c}</th>)}<th></th></tr></thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                {renderRow(row)}
                <td>
                  <button className="btn btn-ghost btn-sm" disabled={busyId === row.id} onClick={() => onRepost(row)}>
                    {busyId === row.id ? 'Posting…' : 'Re-post'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
