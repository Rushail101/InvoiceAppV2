/**
 * Reconciliation.jsx — Bank Reconciliation Statement
 *
 * Three-layer matching:
 *  1. Bank txn ↔ posted invoice payments (by amount + party + date window)
 *  2. Bank txn ↔ expense journal entries (by amount + date window)
 *  3. Closing balance ↔ trial balance Bank Account ledger total
 *
 * Output: Matched / Unmatched / In-books-not-in-bank / Summary
 */
import { useState, useMemo } from 'react';
import { fmt, fmtDate } from '../lib/constants.js';

const DAY_MS = 86400000;
const DATE_WINDOW = 3; // days tolerance for matching

function parseDate(s) { return s ? new Date(s).getTime() : 0; }

function matchBankToPayments(bankTxns, payments, invoices, parties) {
  const matched = [];
  const usedPayments = new Set();

  for (const btxn of bankTxns) {
    if (btxn.type !== 'credit') continue;
    const bDate = parseDate(btxn.txn_date || btxn.date);
    const bAmt = Number(btxn.amount);

    for (const pay of payments) {
      if (usedPayments.has(pay.id)) continue;
      const pAmt = Number(pay.amount);
      const pDate = parseDate(pay.payment_date);
      if (Math.abs(pAmt - bAmt) < 0.5 && Math.abs(bDate - pDate) <= DATE_WINDOW * DAY_MS) {
        const inv = invoices.find(i => i.id === pay.invoice_id);
        const party = parties.find(p => p.id === pay.party_id);
        matched.push({ bankTxn: btxn, match: pay, matchType: 'payment', invoice: inv, party });
        usedPayments.add(pay.id);
        break;
      }
    }
  }
  return matched;
}

function matchBankToJE(bankTxns, journalEntries, journalLines, accounts, matchedBankIds) {
  const matched = [];
  const usedJEs = new Set();

  const bankAcct = accounts.find(a => a.name.toLowerCase().includes('bank'));
  if (!bankAcct) return matched;

  for (const btxn of bankTxns) {
    if (matchedBankIds.has(btxn.id)) continue;
    const bDate = parseDate(btxn.txn_date || btxn.date);
    const bAmt = Number(btxn.amount);

    for (const je of journalEntries) {
      if (usedJEs.has(je.id)) continue;
      const jeDate = parseDate(je.entry_date);
      if (Math.abs(bDate - jeDate) > DATE_WINDOW * DAY_MS) continue;

      const lines = journalLines.filter(l => l.journal_id === je.id);
      const bankLine = lines.find(l => l.account_id === bankAcct.id);
      if (!bankLine) continue;

      const lineAmt = btxn.type === 'credit' ? Number(bankLine.debit) : Number(bankLine.credit);
      if (Math.abs(lineAmt - bAmt) < 0.5) {
        const otherLine = lines.find(l => l.account_id !== bankAcct.id);
        const otherAcct = otherLine ? accounts.find(a => a.id === otherLine.account_id) : null;
        matched.push({ bankTxn: btxn, match: je, matchType: 'journal', account: otherAcct });
        usedJEs.add(je.id);
        break;
      }
    }
  }
  return matched;
}

export function ReconciliationView({
  bankAccounts, bankTransactions, journalEntries, journalLines,
  payments, invoices, parties, accounts, activeBiz
}) {
  const [selectedBankAcct, setSelectedBankAcct] = useState(bankAccounts[0]?.id || '');
  const [month, setMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });
  const [tab, setTab] = useState('summary'); // summary | matched | unmatched | inbooks

  const bizAccounts  = accounts.filter(a => a.business_id === activeBiz);
  const bankAcct     = bizAccounts.find(a => a.name.toLowerCase().includes('bank'));

  const { matchedPayments, matchedJEs, unmatchedBank, inBooksNotBank, closing, trialBalance, reconciled } = useMemo(() => {
    // Filter bank txns for selected account + month
    const [yr, mo] = month.split('-').map(Number);
    const monthStart = new Date(yr, mo - 1, 1).getTime();
    const monthEnd   = new Date(yr, mo, 0, 23, 59, 59).getTime();

    const filtered = bankTransactions.filter(t => {
      if (selectedBankAcct && t.bank_account_id !== selectedBankAcct) return false;
      const d = parseDate(t.txn_date || t.date);
      return d >= monthStart && d <= monthEnd;
    });

    // Layer 1: match to payments
    const mp = matchBankToPayments(filtered, payments, invoices, parties);
    const matchedBankIds = new Set(mp.map(m => m.bankTxn.id));

    // Layer 2: match remaining to JEs
    const mj = matchBankToJE(filtered, journalEntries, journalLines, bizAccounts, matchedBankIds);
    mj.forEach(m => matchedBankIds.add(m.bankTxn.id));

    // Unmatched bank txns
    const unmatched = filtered.filter(t => !matchedBankIds.has(t.id));

    // Closing bank balance from statement (last txn balance)
    const sorted = [...filtered].sort((a, b) =>
      parseDate(a.txn_date || a.date) - parseDate(b.txn_date || b.date)
    );
    const closing = sorted[sorted.length - 1]?.balance ?? null;

    // Trial balance for Bank Account
    const relevantJEs = new Set(
      journalEntries.filter(j => j.business_id === activeBiz).map(j => j.id)
    );
    let tbDebit = 0, tbCredit = 0;
    if (bankAcct) {
      journalLines.filter(l => relevantJEs.has(l.journal_id) && l.account_id === bankAcct.id)
        .forEach(l => { tbDebit += Number(l.debit || 0); tbCredit += Number(l.credit || 0); });
    }
    const trialBalance = tbDebit - tbCredit;

    // In-books-not-in-bank: JEs for bank account in this month not matched to any bank txn
    const matchedJEIds = new Set(mj.map(m => m.match.id));
    const inBooks = journalEntries.filter(je => {
      const jeDate = parseDate(je.entry_date);
      if (jeDate < monthStart || jeDate > monthEnd) return false;
      if (matchedJEIds.has(je.id)) return false;
      return journalLines.some(l => l.journal_id === je.id && bankAcct && l.account_id === bankAcct.id);
    });

    const reconciled = closing !== null && Math.abs(closing - trialBalance) < 1;

    return { matchedPayments: mp, matchedJEs: mj, unmatchedBank: unmatched, inBooksNotBank: inBooks, closing, trialBalance, reconciled };
  }, [bankTransactions, payments, invoices, journalEntries, journalLines, accounts, selectedBankAcct, month, activeBiz]);

  const totalMatched = matchedPayments.length + matchedJEs.length;
  const tabs = [
    { id: 'summary',   label: 'Summary',        count: null },
    { id: 'matched',   label: 'Matched',         count: totalMatched },
    { id: 'unmatched', label: 'Unmatched (Bank)',count: unmatchedBank.length },
    { id: 'inbooks',   label: 'In Books Only',   count: inBooksNotBank.length },
  ];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Bank Account</label>
          <select value={selectedBankAcct} onChange={e => setSelectedBankAcct(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 13 }}>
            {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text1)', fontSize: 13 }} />
        </div>
      </div>

      {/* Status banner */}
      <div style={{
        padding: '14px 18px', borderRadius: 10, marginBottom: 20,
        background: reconciled ? '#0a1f12' : '#1f0f0a',
        border: `1px solid ${reconciled ? '#1a5c36' : '#5c2a0a'}`,
        display: 'flex', alignItems: 'center', gap: 12
      }}>
        <span style={{ fontSize: 28 }}>{reconciled ? '✅' : '⚠️'}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: reconciled ? '#4ade80' : '#fb923c' }}>
            {reconciled ? 'Books are reconciled for this month' : 'Reconciliation difference found'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Bank closing balance: <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)' }}>
              {closing !== null ? fmt(closing) : 'N/A (balance not in import)'}
            </span>
            {' · '}
            Trial balance (Bank ledger): <span style={{ color: 'var(--text1)', fontFamily: 'var(--mono)' }}>{fmt(trialBalance)}</span>
            {closing !== null && !reconciled && (
              <span style={{ color: '#fb923c' }}> · Difference: {fmt(Math.abs(closing - trialBalance))}</span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {tabs.map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              background: tab === t.id ? 'var(--accent)' : 'var(--bg2)',
              color: tab === t.id ? '#fff' : 'var(--text2)',
            }}>
            {t.label}{t.count !== null ? <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>({t.count})</span> : ''}
          </button>
        ))}
      </div>

      {/* Summary Tab */}
      {tab === 'summary' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'Bank transactions this month', val: matchedPayments.length + matchedJEs.length + unmatchedBank.length, sub: '' },
            { label: 'Matched to payments/JEs',     val: totalMatched, sub: `${matchedPayments.length} payments · ${matchedJEs.length} journal entries`, color: '#4ade80' },
            { label: 'Unmatched bank transactions',  val: unmatchedBank.length, sub: 'In bank, not in books', color: unmatchedBank.length ? '#fb923c' : '#4ade80' },
            { label: 'In books, not in bank',        val: inBooksNotBank.length, sub: 'JEs with no bank txn', color: inBooksNotBank.length ? '#fbbf24' : '#4ade80' },
          ].map(s => (
            <div key={s.label} style={{ padding: '16px 18px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border2)' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.color || 'var(--text1)', fontFamily: 'var(--mono)' }}>{s.val}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>{s.label}</div>
              {s.sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{s.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Matched Tab */}
      {tab === 'matched' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {matchedPayments.map((m, i) => (
            <MatchedRow key={i} bankTxn={m.bankTxn} matchType="Invoice Payment"
              detail={`${m.party?.name || 'Unknown party'} · ${m.invoice?.invoice_number || ''}`}
              amount={m.bankTxn.amount} type={m.bankTxn.type} />
          ))}
          {matchedJEs.map((m, i) => (
            <MatchedRow key={'je'+i} bankTxn={m.bankTxn} matchType="Journal Entry"
              detail={`${m.match.narration || m.match.reference || ''} · ${m.account?.name || ''}`}
              amount={m.bankTxn.amount} type={m.bankTxn.type} />
          ))}
          {totalMatched === 0 && <Empty msg="No matched transactions for this period" />}
        </div>
      )}

      {/* Unmatched Tab */}
      {tab === 'unmatched' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {unmatchedBank.length > 0 && (
            <div style={{ fontSize: 12, color: '#fb923c', marginBottom: 8 }}>
              These transactions are in your bank statement but have no matching journal entry. Import them via Bank Import.
            </div>
          )}
          {unmatchedBank.map((t, i) => <BankTxnRow key={i} txn={t} />)}
          {unmatchedBank.length === 0 && <Empty msg="All bank transactions are matched ✅" />}
        </div>
      )}

      {/* In Books Tab */}
      {tab === 'inbooks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {inBooksNotBank.length > 0 && (
            <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 8 }}>
              These journal entries affect the Bank Account ledger but have no matching bank transaction.
            </div>
          )}
          {inBooksNotBank.map((je, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 10, padding: '9px 12px', background: 'var(--bg2)', borderRadius: 7, border: '1px solid var(--border2)', alignItems: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{je.entry_date}</div>
              <div>
                <div style={{ fontSize: 12.5, color: 'var(--text1)' }}>{je.narration || je.reference}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{je.source || 'manual'}</div>
              </div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: '#1a1a0a', border: '1px solid #3a3a10', color: '#fbbf24' }}>In books only</span>
            </div>
          ))}
          {inBooksNotBank.length === 0 && <Empty msg="All book entries have matching bank transactions ✅" />}
        </div>
      )}
    </div>
  );
}

function MatchedRow({ bankTxn, matchType, detail, amount, type }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto auto', gap: 10, padding: '9px 12px', background: 'var(--bg2)', borderRadius: 7, border: '1px solid #1a4a2a', alignItems: 'center' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{bankTxn.txn_date || bankTxn.date}</div>
      <div>
        <div style={{ fontSize: 12.5, color: 'var(--text1)' }}>{bankTxn.description}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{detail}</div>
      </div>
      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: '#0a1f12', border: '1px solid #1a5c36', color: '#4ade80' }}>{matchType}</span>
      <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: type === 'credit' ? '#4ade80' : '#f87171', textAlign: 'right', minWidth: 90 }}>
        {type === 'credit' ? '+' : '-'}{fmt(amount)}
      </div>
    </div>
  );
}

function BankTxnRow({ txn }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 10, padding: '9px 12px', background: 'var(--bg2)', borderRadius: 7, border: '1px solid #3a1a0a', alignItems: 'center' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{txn.txn_date || txn.date}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text1)' }}>{txn.description}</div>
      <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: txn.type === 'credit' ? '#4ade80' : '#f87171', textAlign: 'right', minWidth: 90 }}>
        {txn.type === 'credit' ? '+' : '-'}{fmt(txn.amount)}
      </div>
    </div>
  );
}

function Empty({ msg }) {
  return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: 13 }}>{msg}</div>;
}
