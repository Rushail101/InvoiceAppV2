// BankLinks.jsx — Bank Receipts: link bank credits to invoices / proformas
//
// Modelled on NovaGeo's vendor-project payment linking:
//   * every bank credit is a pool item; links carry amounts, so a credit can be split across several
//     invoices and a payment can be covered by several credits (remaining = amount - linked)
//   * "Needs linking" is the unassigned list; linking only TAGS — it never edits bank rows,
//     payments or the journal, so nothing is double-counted
//   * payments you already entered by hand are recognised automatically (Auto-link), so they never
//     show up as unlinked
//
// The one action that creates anything is "Record receipt" on a credit that has no payment yet; it
// uses the app's normal payment paths (see recordReceiptFromBank in db.js).
import { useState, useMemo } from 'react';
import { fmt, fmtDate } from '../lib/constants.js';
import { ModalShell, StatCard, EmptyState, PillTabs } from '../components/ui.jsx';
import { addBankLinks, deleteBankLink, dismissBankCredit, recordReceiptFromBank } from '../lib/db.js';
import {
  EPS, buildCoverage, creditRemaining, paymentRemaining, autoMatch, suggestInvoices, paymentChoicesForCredit,
  creditChoicesForPayment, paymentsNotInBank, txnTypeFor, journalKeys, isDoubleBooked, paidByInvoice, businessOfAccounts, txnDate,
} from '../lib/bankLinks.js';

const ROW_CAP = 200;
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sty = {
  chip: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 11 },
  warn: { color: '#fbbf24', fontSize: 11 },
  dim: { color: 'var(--text3)', fontSize: 11 },
  note: { background: '#2b1f08', border: '1px solid #5c3d0a', color: '#fbbf24', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 14 },
};

export function BankLinksView({
  bankTransactions = [], bankAccounts = [], payments = [], invoices = [], parties = [], journalEntries = [],
  bankLinks = [], bankLinksReady = true, bankLinksError = '', activeBiz, reload,
}) {
  const [dir, setDir] = useState('in');            // 'in' = receipts vs sales, 'out' = payments vs purchase bills
  const isOut = dir === 'out';
  const [tab, setTab] = useState('needs');
  const [search, setSearch] = useState('');
  const [autoOpen, setAutoOpen] = useState(false);
  const [invFor, setInvFor] = useState(null);      // bank txn id -> "record receipt against invoice"
  const [payFor, setPayFor] = useState(null);      // bank txn id -> "link to existing payment"
  const [creditFor, setCreditFor] = useState(null); // payment id  -> "link to bank credit"
  const [busy, setBusy] = useState('');

  const scopedAccts = useMemo(() => bankAccounts.filter(b => !activeBiz || b.business_id === activeBiz), [bankAccounts, activeBiz]);
  const acctIds = useMemo(() => new Set(scopedAccts.map(b => b.id)), [scopedAccts]);
  const txns = useMemo(() => bankTransactions.filter(t => acctIds.has(t.bank_account_id)), [bankTransactions, acctIds]);
  const scopedPayments = useMemo(() => payments.filter(p => !activeBiz || p.business_id === activeBiz), [payments, activeBiz]);
  const scopedInvoices = useMemo(() => invoices.filter(i => !activeBiz || i.business_id === activeBiz), [invoices, activeBiz]);

  const cov = useMemo(() => buildCoverage(bankLinks), [bankLinks]);
  const keys = useMemo(() => journalKeys(journalEntries), [journalEntries]);
  const invoiceById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);
  const partyById = useMemo(() => new Map(parties.map(p => [p.id, p])), [parties]);
  const paymentById = useMemo(() => new Map(payments.map(p => [p.id, p])), [payments]);
  const ctx = useMemo(() => ({ invoices: scopedInvoices, payments, parties, bankAccounts, links: bankLinks, bankTxns: txns, dir }),
    [scopedInvoices, payments, parties, bankAccounts, bankLinks, txns, dir]);

  const credits = useMemo(() => txns.filter(t => t.type === txnTypeFor(dir)), [txns, dir]);
  const needs = useMemo(() => credits.filter(t => !t.link_dismissed && creditRemaining(t, cov) > EPS)
    .sort((a, b) => String(txnDate(b)).localeCompare(String(txnDate(a)))), [credits, cov]);
  const linkedRows = useMemo(() => credits.filter(t => (cov.byBank.get(t.id) || 0) > 0)
    .sort((a, b) => String(txnDate(b)).localeCompare(String(txnDate(a)))), [credits, cov]);
  const dismissed = useMemo(() => credits.filter(t => t.link_dismissed), [credits]);
  const notInBank = useMemo(() => paymentsNotInBank({ payments: scopedPayments, invoices, bankTxns: txns, bankAccounts, links: bankLinks, dir })
    .sort((a, b) => String(b.payment.payment_date).localeCompare(String(a.payment.payment_date))), [scopedPayments, invoices, txns, bankAccounts, bankLinks, dir]);

  const q = search.trim().toLowerCase();
  const match = (t) => !q || `${t.description || ''} ${t.reference || ''} ${t.amount}`.toLowerCase().includes(q);

  const totalCredit = credits.reduce((s, t) => s + Number(t.amount || 0), 0);
  const needsAmt = needs.reduce((s, t) => s + creditRemaining(t, cov), 0);
  const linksByBank = useMemo(() => { const m = new Map(); bankLinks.forEach(l => (m.get(l.bank_txn_id) || m.set(l.bank_txn_id, []).get(l.bank_txn_id)).push(l)); return m; }, [bankLinks]);

  const paidAll = useMemo(() => paidByInvoice(payments), [payments]);
  const hasBankJournal = t => keys.has(`bank_import:${t.id}`) || (!journalEntries.length && t.journal_posted === true);

  async function doRecord(txn, inv, amount) {
    const amt = r2(amount);
    const jr = hasBankJournal(txn);
    const msg = `Record ${fmt(amt)} ${isOut ? 'paid' : 'received'} (${fmtDate(txnDate(txn))}) against ${inv.status === 'proforma' ? 'proforma ' : 'invoice '}${inv.invoice_number}?\n\n` +
      (jr ? 'This bank row already has its own journal entry, so the payment is saved WITHOUT a second entry.'
          : isOut ? 'This bank row has no journal entry yet, so the payment is saved with its normal entry (Dr Payable / Cr Bank).'
                  : 'This bank row has no journal entry yet, so the payment is saved with its normal entry (Dr Bank / Cr Sales Revenue).');
    if (!confirm(msg)) return false;
    setBusy(txn.id + inv.id);
    try {
      const paidBefore = payments.filter(p => p.invoice_id === inv.id).reduce((s, p) => s + Number(p.amount), 0);
      await recordReceiptFromBank({ txn, invoice: inv, amount: amt, hasJournal: jr, allPayments: payments });
      await reload();
      if (inv.status === 'proforma' && paidBefore + amt >= Number(inv.total) - 0.01) {
        alert(`${inv.invoice_number} is now fully paid. Convert it to a Tax Invoice from the Proforma screen.`);
      }
      return true;
    } catch (e) { alert(e.message || String(e)); return false; }
    finally { setBusy(''); }
  }

  async function doLinkPayment(txn, payment, amount) {
    setBusy(txn.id + payment.id);
    try {
      await addBankLinks([{ bank_txn_id: txn.id, payment_id: payment.id, amount: r2(amount), source: 'manual' }]);
      await reload();
      return true;
    } catch (e) { alert(e.message || String(e)); return false; }
    finally { setBusy(''); }
  }

  async function unlink(l) {
    if (!confirm('Remove this link? The payment and the bank row stay exactly as they are — they just become unlinked again.')) return;
    try { await deleteBankLink(l.id); await reload(); } catch (e) { alert(e.message || String(e)); }
  }
  async function dismiss(t) {
    const note = prompt('Why is this not an invoice ' + (isOut ? 'payment? (salary, tax, loan repayment, charges…)' : 'receipt? (loan, capital introduced, refund, interest…)') + '', '');
    if (note === null) return;
    try { await dismissBankCredit(t.id, true, note); await reload(); } catch (e) { alert(e.message || String(e)); }
  }
  async function restore(t) {
    try { await dismissBankCredit(t.id, false); await reload(); } catch (e) { alert(e.message || String(e)); }
  }

  if (!bankLinksReady) {
    return (
      <div style={{ maxWidth: 720 }}>
        <div style={sty.note}>
          <strong>One-time setup needed.</strong> Run <code>accounts_app/sql/migrations/002_bank_txn_links.sql</code> in the Supabase SQL editor,
          then press Refresh. Everything else keeps working until then.
          {bankLinksError && <div style={{ marginTop: 6, opacity: .8 }}>{bankLinksError}</div>}
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'needs', label: `Needs linking (${needs.length})` },
    { id: 'linked', label: `Linked (${linkedRows.length})` },
    { id: 'notinbank', label: `Payments not in bank (${notInBank.length})` },
    { id: 'dismissed', label: `${isOut ? 'Not a bill payment' : 'Not a receipt'} (${dismissed.length})` },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <PillTabs tabs={[{ id: 'in', label: 'Money in — sales / proformas' }, { id: 'out', label: 'Money out — purchase bills' }]} active={dir} onChange={d => { setDir(d); setTab('needs'); }} />
      </div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 14 }}>
        <StatCard label={isOut ? 'Bank debits' : 'Bank credits'} value={credits.length} sub={fmt(totalCredit)} color="blue" />
        <StatCard label="Linked" value={linkedRows.length} sub={fmt(credits.reduce((s, t) => s + (cov.byBank.get(t.id) || 0), 0))} color="green" />
        <StatCard label="Needs linking" value={needs.length} sub={fmt(needsAmt)} color={needs.length ? 'amber' : 'green'} />
        <StatCard label="Payments not in bank" value={notInBank.length} sub="non-cash, in statement range" color="purple" />
      </div>

      <div className="filter-bar">
        <PillTabs tabs={tabs} active={tab} onChange={setTab} />
        <input placeholder="Search narration, UTR, amount…" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setAutoOpen(true)}>⚡ Auto-link existing payments</button>
      </div>

      {tab === 'needs' && (
        <NeedsList rows={needs.filter(match)} cov={cov} ctx={ctx} busy={busy} partyById={partyById}
          onSuggest={doRecord} onInvoice={t => setInvFor(t.id)} onPayment={t => setPayFor(t.id)} onDismiss={dismiss} />
      )}

      {tab === 'linked' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Bank narration</th><th className="r">{isOut ? 'Debit' : 'Credit'}</th><th>Linked to</th></tr></thead>
            <tbody>
              {linkedRows.filter(match).slice(0, ROW_CAP).map(t => (
                <tr key={t.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtDate(txnDate(t))}</td>
                  <td style={{ fontSize: 12.5, maxWidth: 280 }}>{t.description}<div style={sty.dim}>{t.reference || ''}</div></td>
                  <td className="r mono" style={{ color: isOut ? 'var(--red)' : 'var(--green)' }}>{fmt(t.amount)}
                    {creditRemaining(t, cov) > EPS && <div style={sty.warn}>{fmt(creditRemaining(t, cov))} still unlinked</div>}</td>
                  <td>
                    {(linksByBank.get(t.id) || []).map(l => {
                      const p = paymentById.get(l.payment_id); const inv = p && invoiceById.get(p.invoice_id);
                      const dbl = p && journalEntries.length > 0 && isDoubleBooked(t, p, keys);
                      return (
                        <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                          <span style={sty.chip}>
                            {inv?.status === 'proforma' && <span className="badge badge-proforma">PI</span>}
                            <strong>{inv?.invoice_number || '—'}</strong>
                            <span style={sty.dim}>{partyById.get(p?.party_id || inv?.party_id)?.name || ''}</span>
                            <span className="mono">{fmt(l.amount)}</span>
                            {inv && <span style={sty.dim} title="Invoice total / paid so far / balance">of {fmt(inv.total)} · paid {fmt(paidAll.get(inv.id) || 0)} · bal {fmt(Math.max(0, Number(inv.total) - (paidAll.get(inv.id) || 0)))}</span>}
                            <span style={sty.dim}>{l.source}</span>
                          </span>
                          {dbl && <span style={sty.warn} title="This bank row and the payment each have their own journal entry — the receipt is in the books twice. Linking doesn't change that.">⚠ in books twice?</span>}
                          <button className="btn btn-ghost btn-sm" onClick={() => unlink(l)}>Unlink</button>
                        </div>
                      );
                    })}
                  </td>
                </tr>
              ))}
              {linkedRows.length === 0 && <tr><td colSpan={4}><EmptyState icon="🔗" message="Nothing linked yet" sub="Use ⚡ Auto-link to recognise payments you already entered." /></td></tr>}
            </tbody>
          </table>
          {linkedRows.length > ROW_CAP && <p style={sty.dim}>Showing the latest {ROW_CAP} — use search to narrow.</p>}
        </div>
      )}

      {tab === 'notinbank' && (
        <>
          <p style={{ ...sty.dim, marginBottom: 8 }}>
            Payments recorded against invoices / proformas (cash excluded) that don't match any imported bank credit. Only dates covered by your
            imported statements are checked, so history you never imported isn't listed.
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Document</th><th>{isOut ? 'Vendor' : 'Customer'}</th><th>Method / ref</th><th className="r">Amount</th><th></th></tr></thead>
              <tbody>
                {notInBank.filter(({ payment: p, invoice: i }) => !q || `${i?.invoice_number || ''} ${p.reference || ''} ${p.amount} ${partyById.get(p.party_id)?.name || ''}`.toLowerCase().includes(q)).slice(0, ROW_CAP).map(({ payment: p, invoice: i, remaining }) => (
                  <tr key={p.id}>
                    <td className="mono" style={{ fontSize: 11 }}>{fmtDate(p.payment_date)}</td>
                    <td>{i?.status === 'proforma' && <span className="badge badge-proforma" style={{ marginRight: 6 }}>PI</span>}{i?.invoice_number || '—'}</td>
                    <td>{partyById.get(p.party_id || i?.party_id)?.name || '—'}</td>
                    <td style={{ fontSize: 11 }}>{p.method || '—'}<div style={sty.dim}>{p.reference || ''}</div></td>
                    <td className="r mono">{fmt(remaining)}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => setCreditFor(p.id)}>Link to bank credit…</button></td>
                  </tr>
                ))}
                {notInBank.length === 0 && <tr><td colSpan={6}><EmptyState icon="✅" message="Every non-cash payment in the statement range is linked" /></td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'dismissed' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Bank narration</th><th className="r">{isOut ? 'Debit' : 'Credit'}</th><th>Note</th><th></th></tr></thead>
            <tbody>
              {dismissed.filter(match).map(t => (
                <tr key={t.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtDate(txnDate(t))}</td>
                  <td style={{ fontSize: 12.5 }}>{t.description}</td>
                  <td className="r mono">{fmt(t.amount)}</td>
                  <td style={sty.dim}>{t.link_note || '—'}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => restore(t)}>Restore</button></td>
                </tr>
              ))}
              {dismissed.length === 0 && <tr><td colSpan={5}><EmptyState icon="📭" message="No credits marked as not-a-receipt" /></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {autoOpen && (
        <AutoLinkModal ctx={ctx} cov={cov} keys={keys} journalLoaded={journalEntries.length > 0} partyById={partyById} invoiceById={invoiceById}
          onClose={() => setAutoOpen(false)} onDone={async () => { await reload(); }} />
      )}
      {invFor && (() => {
        const t = bankTransactions.find(x => x.id === invFor);
        return t ? <InvoicePickModal txn={t} cov={cov} ctx={ctx} partyById={partyById} busy={busy} onRecord={doRecord} onClose={() => setInvFor(null)} /> : null;
      })()}
      {payFor && (() => {
        const t = bankTransactions.find(x => x.id === payFor);
        return t ? <PaymentPickModal txn={t} cov={cov} ctx={ctx} keys={keys} journalLoaded={journalEntries.length > 0} invoiceById={invoiceById} partyById={partyById} busy={busy} onLink={doLinkPayment} onClose={() => setPayFor(null)} /> : null;
      })()}
      {creditFor && (() => {
        const p = payments.find(x => x.id === creditFor);
        return p ? <CreditPickModal payment={p} cov={cov} ctx={ctx} keys={keys} journalLoaded={journalEntries.length > 0} busy={busy} onLink={(t, amt) => doLinkPayment(t, p, amt)} onClose={() => setCreditFor(null)} /> : null;
      })()}
    </div>
  );
}

// ── Needs linking ───────────────────────────────────────────────────────────
function NeedsList({ rows, cov, ctx, busy, partyById, onSuggest, onInvoice, onPayment, onDismiss }) {
  const out = ctx.dir === 'out';
  const shown = rows.slice(0, ROW_CAP);
  const suggestions = useMemo(() => new Map(shown.map(t => [t.id, suggestInvoices(t, ctx)])), [shown, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return <EmptyState icon="✅" message={out ? "Every bank debit is linked" : "Every bank credit is linked"} sub="New statement imports will appear here when they need attention." />;
  return (
    <>
      <p style={{ ...sty.dim, marginBottom: 8 }}>
        {out ? 'Bank debits not yet tied to a purchase bill.' : 'Bank credits not yet tied to an invoice or proforma.'} Held rows from the import land here; linking one creates its journal entry (rows that already have one are never posted twice).
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {shown.map(t => {
          const rem = creditRemaining(t, cov); const sg = suggestions.get(t.id) || [];
          return (
            <div key={t.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr auto', gap: 10, alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(txnDate(t))}</div>
                <div style={{ fontSize: 12.5, minWidth: 0 }}>{t.description}<div style={sty.dim}>{t.reference || ''}</div></div>
                <div className="mono" style={{ fontWeight: 700, color: out ? 'var(--red)' : 'var(--green)', textAlign: 'right' }}>
                  {out ? '−' : '+'}{fmt(rem)}{rem < Number(t.amount) - EPS && <div style={sty.dim}>of {fmt(t.amount)}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                {sg.map(s => {
                  const amt = Math.min(rem, s.outstanding);
                  return (
                    <button key={s.invoice.id} className="btn btn-ghost btn-sm" disabled={busy === t.id + s.invoice.id}
                      onClick={() => onSuggest(t, s.invoice, amt)} title={s.reasons.join(' · ')}>
                      {s.isProforma && <span className="badge badge-proforma" style={{ marginRight: 4 }}>PI</span>}
                      {s.invoice.invoice_number} · {partyById.get(s.invoice.party_id)?.name || ''} · {fmt(amt)} of {fmt(s.total)} (paid {fmt(s.paid)}, bal {fmt(s.outstanding)}) →
                    </button>
                  );
                })}
                <button className="btn btn-ghost btn-sm" onClick={() => onInvoice(t)}>{out ? 'Purchase bill…' : 'Invoice / proforma…'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => onPayment(t)}>Existing payment…</button>
                <button className="btn btn-ghost btn-sm" onClick={() => onDismiss(t)} style={{ marginLeft: 'auto' }}>{out ? 'Not a bill payment' : 'Not a receipt'}</button>
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > ROW_CAP && <p style={sty.dim}>Showing the latest {ROW_CAP} of {rows.length} — use search to narrow.</p>}
    </>
  );
}

// ── Auto-link preview ───────────────────────────────────────────────────────
function AutoLinkModal({ ctx, cov, keys, journalLoaded, partyById, invoiceById, onClose, onDone }) {
  const res = useMemo(() => autoMatch({ bankTxns: ctx.bankTxns, payments: ctx.payments, invoices: ctx.invoices, bankAccounts: ctx.bankAccounts, links: ctx.links, dir: ctx.dir }), [ctx]);
  const [off, setOff] = useState(() => new Set());          // exact matches the user un-ticked
  const [comboOn, setComboOn] = useState(() => new Set());  // combos the user ticked (default off)
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const dbl = res.auto.filter(a => journalLoaded && isDoubleBooked(a.txn, a.payment, keys)).length;
  const chosenAuto = res.auto.filter(a => !off.has(a.txn.id));
  const chosenCombos = res.combos.filter(c => comboOn.has(c.txn.id));
  const invNo = p => invoiceById.get(p.invoice_id)?.invoice_number || '—';

  async function apply() {
    setBusy(true);
    try {
      const rows = [
        ...chosenAuto.map(a => ({ bank_txn_id: a.txn.id, payment_id: a.payment.id, amount: a.amount, source: 'auto' })),
        ...chosenCombos.flatMap(c => c.payments.map((p, i) => ({ bank_txn_id: c.txn.id, payment_id: p.id, amount: c.amounts[i], source: 'auto' }))),
      ];
      // insert in chunks so a very large first run doesn't hit request-size limits
      for (let i = 0; i < rows.length; i += 200) await addBankLinks(rows.slice(i, i + 200));
      await onDone();
      setDone(rows.length);
    } catch (e) { alert(e.message || String(e)); }
    setBusy(false);
  }

  return (
    <ModalShell title="Auto-link existing payments" size="modal-xl" onClose={onClose}
      foot={done != null
        ? <button className="btn btn-primary" onClick={onClose}>Done — {done} link{done !== 1 ? 's' : ''} created</button>
        : <><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || (!chosenAuto.length && !chosenCombos.length)} onClick={apply}>
              {busy ? 'Linking…' : `Link ${chosenAuto.length + chosenCombos.length} match${chosenAuto.length + chosenCombos.length !== 1 ? 'es' : ''}`}
            </button></>}>
      <p style={{ ...sty.dim, marginBottom: 10 }}>
        Matches the payments you entered by hand to bank credits by exact amount and date (±5 days; a matching UTR widens that), same business and
        customer. Cash payments are skipped. Pairs that can't be told apart are never guessed — they're left for you below.
        This only tags records; no payment, bank row or journal entry is created or changed.
      </p>
      {dbl > 0 && (
        <div style={sty.note}>
          ⚠ {dbl} of these receipts already have a journal entry from the bank import <em>and</em> another from the payment — the books may hold them twice.
          Linking is still safe (it changes nothing); check them in Journal Vouchers / the P&amp;L.
        </div>
      )}

      <h4 style={{ margin: '4px 0 6px' }}>Exact matches ({res.auto.length})</h4>
      {res.auto.length === 0 ? <p style={sty.dim}>None found — either everything is already linked, or nothing lines up by amount and date.</p> : (
        <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
          <table>
            <thead><tr><th></th><th>Bank credit</th><th className="r">Amount</th><th>Payment</th><th></th></tr></thead>
            <tbody>
              {res.auto.slice(0, 500).map(a => (
                <tr key={a.txn.id}>
                  <td><input type="checkbox" checked={!off.has(a.txn.id)} onChange={e => setOff(s => { const n = new Set(s); e.target.checked ? n.delete(a.txn.id) : n.add(a.txn.id); return n; })} /></td>
                  <td style={{ fontSize: 12 }}><span className="mono" style={sty.dim}>{fmtDate(txnDate(a.txn))}</span> {a.txn.description}</td>
                  <td className="r mono">{fmt(a.amount)}</td>
                  <td style={{ fontSize: 12 }}><span className="mono" style={sty.dim}>{fmtDate(a.payment.payment_date)}</span> {invNo(a.payment)} · {partyById.get(a.payment.party_id)?.name || ''}</td>
                  <td style={sty.dim}>{a.refMatch ? 'UTR ✓ ' : ''}{a.dateDiff >= 1 ? `${Math.round(a.dateDiff)}d apart` : 'same day'}{journalLoaded && isDoubleBooked(a.txn, a.payment, keys) ? <span style={sty.warn}> · ⚠ twice?</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res.auto.length > 500 && <p style={sty.dim}>Preview shows the first 500; all ticked matches are applied.</p>}

      {res.combos.length > 0 && (
        <>
          <h4 style={{ margin: '16px 0 6px' }}>One credit paying several invoices ({res.combos.length}) <span style={sty.dim}>— tick to include</span></h4>
          <div className="table-wrap" style={{ maxHeight: 200, overflow: 'auto' }}>
            <table>
              <tbody>
                {res.combos.map(c => (
                  <tr key={c.txn.id}>
                    <td><input type="checkbox" checked={comboOn.has(c.txn.id)} onChange={e => setComboOn(s => { const n = new Set(s); e.target.checked ? n.add(c.txn.id) : n.delete(c.txn.id); return n; })} /></td>
                    <td style={{ fontSize: 12 }}><span className="mono" style={sty.dim}>{fmtDate(txnDate(c.txn))}</span> {c.txn.description}</td>
                    <td className="r mono">{fmt(c.txn.amount)}</td>
                    <td style={{ fontSize: 12 }}>{c.payments.map((p, i) => `${invNo(p)} (${fmt(c.amounts[i])})`).join(' + ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {res.ambiguous.length > 0 && (
        <>
          <h4 style={{ margin: '16px 0 6px' }}>Need your eye ({res.ambiguous.length})</h4>
          <p style={sty.dim}>
            These credits have more than one equally good payment (same amount, same date). Not linked automatically — find them in
            <strong> Needs linking → Existing payment…</strong> and pick the right one.
          </p>
        </>
      )}
    </ModalShell>
  );
}

// ── Link to an invoice / proforma (creates the payment) ─────────────────────
function InvoicePickModal({ txn, cov, ctx, partyById, busy, onRecord, onClose }) {
  const rem = creditRemaining(txn, cov);
  const [q, setQ] = useState('');
  const [amts, setAmts] = useState({});
  const paid = useMemo(() => paidByInvoice(ctx.payments), [ctx.payments]);
  const biz = businessOfAccounts(ctx.bankAccounts).get(txn.bank_account_id);
  const ranked = useMemo(() => {
    const sg = new Map(suggestInvoices(txn, ctx, 50).map(s => [s.invoice.id, s.score]));
    return ctx.invoices
      .filter(i => (i.type === 'purchase') === (ctx.dir === 'out') && !['cancelled', 'draft'].includes(i.status) && (!biz || i.business_id === biz))
      .map(i => ({ inv: i, out: r2(Number(i.total) - (paid.get(i.id) || 0)), score: sg.get(i.id) || 0 }))
      .filter(x => x.out > EPS)
      .sort((a, b) => b.score - a.score || String(b.inv.issue_date).localeCompare(String(a.inv.issue_date)));
  }, [txn, ctx, paid, biz]);
  const ql = q.trim().toLowerCase();
  const list = ranked.filter(x => !ql || `${x.inv.invoice_number} ${x.inv.proforma_number || ''} ${partyById.get(x.inv.party_id)?.name || ''}`.toLowerCase().includes(ql)).slice(0, 60);

  return (
    <ModalShell title={`${ctx.dir === 'out' ? 'Record payment' : 'Record receipt'} — ${fmt(rem)} left to link`} size="modal-lg" onClose={onClose} foot={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <p style={{ ...sty.dim, marginBottom: 8 }}>{fmtDate(txnDate(txn))} · {txn.description}</p>
      <p style={{ ...sty.dim, marginBottom: 10 }}>
        Pick the invoice or proforma this money paid for. Change the amount to link only part of it — the rest stays here for another invoice.
        A proforma stays a proforma (convert it from the Proforma screen).
      </p>
      <input placeholder="Search invoice no. or customer…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Document</th><th>{ctx.dir === 'out' ? 'Vendor' : 'Customer'}</th><th className="r">Total</th><th className="r">Paid</th><th className="r">Balance</th><th className="r">Amount to link</th><th></th></tr></thead>
          <tbody>
            {list.map(({ inv, out, score }) => {
              const val = amts[inv.id] ?? String(Math.min(rem, out));
              return (
                <tr key={inv.id}>
                  <td>{inv.status === 'proforma' && <span className="badge badge-proforma" style={{ marginRight: 6 }}>PI</span>}{inv.invoice_number}{score >= 45 && <span style={{ ...sty.warn, color: '#4ade80' }}> ★</span>}</td>
                  <td>{partyById.get(inv.party_id)?.name || '—'}</td>
                  <td className="r mono">{fmt(inv.total)}</td>
                  <td className="r mono">{fmt(paid.get(inv.id) || 0)}</td>
                  <td className="r mono" style={{ fontWeight: 700 }}>{fmt(out)}</td>
                  <td className="r"><input type="number" min="0" step="0.01" value={val} style={{ width: 110, textAlign: 'right' }} onChange={e => setAmts(a => ({ ...a, [inv.id]: e.target.value }))} /></td>
                  <td><button className="btn btn-primary btn-sm" disabled={busy === txn.id + inv.id || !(Number(val) > 0)}
                    onClick={() => {
                      const n = Number(val);
                      if (n > rem + EPS) return alert(`Only ${fmt(rem)} of this credit is left to link.`);
                      if (n > out + EPS) return alert(`${inv.invoice_number} only has ${fmt(out)} due.`);
                      onRecord(txn, inv, n);
                    }}>Link</button></td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={7}><EmptyState icon="🔍" message="No open invoices or bills match" /></td></tr>}
          </tbody>
        </table>
      </div>
    </ModalShell>
  );
}

// ── Link a credit to an existing (manually entered) payment ─────────────────
function PaymentPickModal({ txn, cov, ctx, keys, journalLoaded, invoiceById, partyById, busy, onLink, onClose }) {
  const rem = creditRemaining(txn, cov);
  const [amts, setAmts] = useState({});
  const list = useMemo(() => paymentChoicesForCredit(txn, ctx).slice(0, 60), [txn, ctx]);
  return (
    <ModalShell title={`Link to an existing payment — ${fmt(rem)} left to link`} size="modal-lg" onClose={onClose} foot={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <p style={{ ...sty.dim, marginBottom: 10 }}>{fmtDate(txnDate(txn))} · {txn.description}. Closest amount and date first. This only tags — no new payment is created.</p>
      <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Date</th><th>Document</th><th>Customer</th><th className="r">Unlinked</th><th className="r">Amount to link</th><th></th></tr></thead>
          <tbody>
            {list.map(({ payment: p, remaining, invoice: inv }) => {
              const val = amts[p.id] ?? String(Math.min(rem, remaining));
              return (
                <tr key={p.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtDate(p.payment_date)}</td>
                  <td>{inv?.status === 'proforma' && <span className="badge badge-proforma" style={{ marginRight: 6 }}>PI</span>}{inv?.invoice_number || '—'}
                    {journalLoaded && isDoubleBooked(txn, p, keys) && <span style={sty.warn}> ⚠ twice?</span>}</td>
                  <td>{partyById.get(p.party_id || inv?.party_id)?.name || '—'}</td>
                  <td className="r mono">{fmt(remaining)}</td>
                  <td className="r"><input type="number" min="0" step="0.01" value={val} style={{ width: 110, textAlign: 'right' }} onChange={e => setAmts(a => ({ ...a, [p.id]: e.target.value }))} /></td>
                  <td><button className="btn btn-primary btn-sm" disabled={busy === txn.id + p.id || !(Number(val) > 0)}
                    onClick={() => {
                      const n = Number(val);
                      if (n > rem + EPS) return alert(`Only ${fmt(rem)} of this credit is left to link.`);
                      if (n > remaining + EPS) return alert(`That payment only has ${fmt(remaining)} unlinked.`);
                      onLink(txn, p, n);
                    }}>Link</button></td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={6}><EmptyState icon="🔍" message="No unlinked payments for this business" sub="Use “Invoice / proforma…” to record the receipt instead." /></td></tr>}
          </tbody>
        </table>
      </div>
    </ModalShell>
  );
}

// ── Link a payment to a bank credit (from "Payments not in bank") ───────────
function CreditPickModal({ payment, cov, ctx, keys, journalLoaded, busy, onLink, onClose }) {
  const rem = paymentRemaining(payment, cov);
  const [amts, setAmts] = useState({});
  const list = useMemo(() => creditChoicesForPayment(payment, ctx).slice(0, 60), [payment, ctx]);
  return (
    <ModalShell title={`Link to a bank credit — ${fmt(rem)} unlinked`} size="modal-lg" onClose={onClose} foot={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <p style={{ ...sty.dim, marginBottom: 10 }}>Payment of {fmt(payment.amount)} dated {fmtDate(payment.payment_date)}. Closest amount and date first.</p>
      <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Date</th><th>Bank narration</th><th className="r">Unlinked</th><th className="r">Amount to link</th><th></th></tr></thead>
          <tbody>
            {list.map(({ txn, remaining }) => {
              const val = amts[txn.id] ?? String(Math.min(rem, remaining));
              return (
                <tr key={txn.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtDate(txnDate(txn))}</td>
                  <td style={{ fontSize: 12 }}>{txn.description}{journalLoaded && isDoubleBooked(txn, payment, keys) && <span style={sty.warn}> ⚠ twice?</span>}</td>
                  <td className="r mono">{fmt(remaining)}</td>
                  <td className="r"><input type="number" min="0" step="0.01" value={val} style={{ width: 110, textAlign: 'right' }} onChange={e => setAmts(a => ({ ...a, [txn.id]: e.target.value }))} /></td>
                  <td><button className="btn btn-primary btn-sm" disabled={busy === txn.id + payment.id || !(Number(val) > 0)}
                    onClick={() => {
                      const n = Number(val);
                      if (n > rem + EPS) return alert(`That payment only has ${fmt(rem)} unlinked.`);
                      if (n > remaining + EPS) return alert(`That credit only has ${fmt(remaining)} left to link.`);
                      onLink(txn, n);
                    }}>Link</button></td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={5}><EmptyState icon="🔍" message="No unlinked bank credits for this business" sub="Import the bank statement first (Bank → Import, or Bulk Bank Import)." /></td></tr>}
          </tbody>
        </table>
      </div>
    </ModalShell>
  );
}
