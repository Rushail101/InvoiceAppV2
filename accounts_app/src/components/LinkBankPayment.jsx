// LinkBankPayment.jsx — "Link Payment" popup for one invoice / proforma / purchase bill.
// Modelled on NovaGeo's "Link Payments" popup for vendor projects: the unassigned bank payments are listed,
// you choose how much of each to link, and press Link. Nothing is matched or filled in automatically.
import { useState, useEffect, useMemo } from 'react';
import { fmt, fmtDate } from '../lib/constants.js';
import { ModalShell, EmptyState } from './ui.jsx';
import { loadLinkableBankData, recordReceiptFromBank } from '../lib/db.js';
import { EPS, buildCoverage, creditRemaining, txnPartyId, txnDate } from '../lib/bankLinks.js';

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function LinkBankPaymentModal({ invoice, parties = [], allPayments = [], onClose, onLinked }) {
  const isPurchase = invoice.type === 'purchase';
  const partyName = parties.find(p => p.id === invoice.party_id)?.name || '';
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [others, setOthers] = useState(false);
  const [amts, setAmts] = useState({});
  const [busy, setBusy] = useState('');
  const [linkedNow, setLinkedNow] = useState(0);

  const load = () => loadLinkableBankData(invoice.business_id, isPurchase ? 'debit' : 'credit')
    .then(setData).catch(e => setErr(`${e.message || e} — has sql/migrations/002_bank_txn_links.sql been run?`));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paid = allPayments.filter(p => p.invoice_id === invoice.id).reduce((s, p) => s + Number(p.amount), 0) + linkedNow;
  const due = r2(Number(invoice.total) - paid);

  const rows = useMemo(() => {
    if (!data) return [];
    const cov = buildCoverage(data.links);
    const ql = q.trim().toLowerCase();
    return data.txns
      .filter(t => !t.link_dismissed && creditRemaining(t, cov) > EPS)
      .map(t => ({ t, rem: creditRemaining(t, cov), mine: txnPartyId(t, parties) === invoice.party_id }))
      .filter(x => (others || x.mine) && (!ql || `${x.t.description} ${x.t.reference} ${x.t.amount}`.toLowerCase().includes(ql)))
      .sort((a, b) => String(txnDate(b.t)).localeCompare(String(txnDate(a.t))));
  }, [data, q, others, parties, invoice.party_id]);
  const mineCount = useMemo(() => !data ? 0 : (() => {
    const cov = buildCoverage(data.links);
    return data.txns.filter(t => !t.link_dismissed && creditRemaining(t, cov) > EPS && txnPartyId(t, parties) === invoice.party_id).length;
  })(), [data, parties, invoice.party_id]);

  async function link(t, rem) {
    const amt = r2(amts[t.id] ?? Math.min(rem, due));
    if (!(amt > 0)) return setErr('Enter an amount greater than zero.');
    if (amt > rem + EPS) return setErr(`Only ${fmt(rem)} of this payment is still unlinked.`);
    if (amt > due + EPS) return setErr(`Only ${fmt(due)} is due on ${invoice.invoice_number}.`);
    setErr(''); setBusy(t.id);
    try {
      await recordReceiptFromBank({ txn: t, invoice, amount: amt, hasJournal: data.journalIds.has(t.id), allPayments });
      setLinkedNow(x => r2(x + amt));
      setAmts(a => { const n = { ...a }; delete n[t.id]; return n; });
      await onLinked?.(amt, txnDate(t), paid + amt);
      await load();
    } catch (e) { setErr(e.message || String(e)); }
    setBusy('');
  }

  return (
    <ModalShell title={`Link Payments: ${partyName ? partyName + ' — ' : ''}${invoice.invoice_number}`} size="modal-lg" onClose={onClose}
      foot={<button className="btn btn-ghost" onClick={onClose}>Done</button>}>
      <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontFamily: 'var(--mono)', fontSize: 13, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <span>Total: <strong>{fmt(invoice.total)}</strong></span>
        <span>{isPurchase ? 'Paid' : 'Received'} so far: <strong style={{ color: 'var(--green)' }}>{fmt(paid)}</strong></span>
        <span>Due: <strong style={{ color: due > EPS ? 'var(--amber)' : 'var(--green)' }}>{fmt(Math.max(0, due))}</strong></span>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <input placeholder="Search narration, amount or UTR…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={others} onChange={e => setOthers(e.target.checked)} /> Show other {isPurchase ? 'vendors' : 'clients'}' payments
        </label>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 8 }}>
        {others ? `Showing every unlinked bank ${isPurchase ? 'debit' : 'credit'}.` : `${mineCount} unlinked bank ${isPurchase ? 'payment(s) to' : 'receipt(s) from'} ${partyName || 'this party'}.`}{' '}
        Change the amount to link only part of a payment — the rest stays available for another invoice. Paid through a different name? Tick “Show other {isPurchase ? 'vendors' : 'clients'}' payments”.
        Rows already in your books are linked without a second journal entry; the others get their entry when linked.
      </p>
      {err && <p className="err-msg">{err}</p>}
      <div className="table-wrap" style={{ maxHeight: 380, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Date</th><th>Narration</th><th>Source</th><th className="r">Payment</th><th className="r">Link amount</th><th></th></tr></thead>
          <tbody>
            {!data && !err && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--text3)' }}>Loading bank transactions…</td></tr>}
            {rows.slice(0, 200).map(({ t, rem }) => {
              const val = amts[t.id] ?? String(Math.max(0, Math.min(rem, due)));
              return (
                <tr key={t.id}>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(txnDate(t))}</td>
                  <td style={{ fontSize: 12, maxWidth: 340 }}>{t.description}<div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{t.reference || ''}</div></td>
                  <td><span className="badge badge-bank">BANK</span>{data.journalIds.has(t.id) && <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 4 }}>in books</span>}</td>
                  <td className="r mono">{fmt(rem)}{rem < Number(t.amount) - EPS && <div style={{ fontSize: 10, color: 'var(--text3)' }}>of {fmt(t.amount)}</div>}</td>
                  <td className="r"><input type="number" min="0" step="0.01" value={val} style={{ width: 110, textAlign: 'right' }} onChange={e => setAmts(a => ({ ...a, [t.id]: e.target.value }))} /></td>
                  <td><button className="btn btn-primary btn-sm" disabled={busy === t.id || due <= EPS} onClick={() => link(t, rem)}>{busy === t.id ? '…' : 'Link'}</button></td>
                </tr>
              );
            })}
            {data && rows.length === 0 && <tr><td colSpan={6}><EmptyState icon="🔍" message="No unlinked bank payments found" sub={others ? 'Import the statement in Bank first.' : 'Try “Show other parties’ payments”, or import the statement in Bank first.'} /></td></tr>}
          </tbody>
        </table>
      </div>
    </ModalShell>
  );
}
