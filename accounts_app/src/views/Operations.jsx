import { useState, useMemo, useEffect } from 'react';
import { fmt, fmtDate, today, PAY_MODES, INDIAN_STATES, STATE_CODES, EXPENSE_CATEGORIES, B2CL_THRESHOLD, effectiveGstin, isGSTINValid, invoiceDue, isOverdue, getFY, fyRange } from '../lib/constants.js';
import { saveParty, deleteParty, saveExpenseWithJournal, deleteExpense, savePayment, saveBankAccount, saveBankTxnWithJournal, deleteBankTxn, deletePayment, updateInvoiceStatus, saveInvoice, uploadExpenseAttachment, getExpenseAttachmentUrl } from '../lib/db.js';
import { Badge, ModalShell, FG, EmptyState, StatCard, PillTabs, toast } from '../components/ui.jsx';
import { tallyExpense, tallyPayment, tallySummary, findDuplicateExpense } from '../lib/tally.js';

// Shared pill shown in the Journal column once a Tally check has run.
// Before that, the column falls back to the plain existence check (✓ / —).
function TallyBadge({ result }) {
  if (!result) return null;
  if (result.status === 'matched') {
    return <span title={result.via === 'bank_import' ? 'Matched to bank-import journal entry' : result.via === 'manual_journal' ? 'Matched to a manually-entered journal voucher (not formally linked, but same date/amount/account)' : 'Date and amount match the journal'}
      style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)' }}>✓ Tallied</span>;
  }
  if (result.status === 'mismatch') {
    return <span title={result.reason} style={{ fontSize: 10, color: '#fb923c', fontFamily: 'var(--mono)', cursor: 'help' }}>⚠ Mismatch</span>;
  }
  return <span title={result.reason} style={{ fontSize: 10, color: 'var(--red)', fontFamily: 'var(--mono)', cursor: 'help' }}>✕ Missing</span>;
}

function tallyAlertText(summary, label) {
  const bits = [`${summary.matched} tallied`];
  if (summary.mismatch) bits.push(`${summary.mismatch} mismatched (hover the ⚠ for detail)`);
  if (summary.missing) bits.push(`${summary.missing} missing a journal entry`);
  return `Tally check — ${label}\n\n${bits.join(' · ')}\n\nOut of ${summary.total} record(s).`;
}

// ─── PARTIES VIEW ─────────────────────────────────────────────────────────────
export function PartiesView({ parties, businesses, activeBiz, reload, invoices = [], payments = [], creditNotes = [] }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editData, setEditData] = useState(null);

  const filtered = parties.filter(p => {
    const biz = activeBiz ? p.business_id === activeBiz : true;
    const t = typeFilter ? p.type === typeFilter : true;
    const q = search.toLowerCase();
    return biz && t && (!q || p.name.toLowerCase().includes(q) || (p.gstin || '').toLowerCase().includes(q));
  });

  async function save(data, id) { await saveParty(data, id); toast(`${data.name} saved`, 'success'); reload(); }
  async function del(p) {
    const used = invoices.some(i => i.party_id === p.id);
    if (!confirm(`Delete ${p.name}?${used ? '\n\nThey have invoices/bills — those will stay but lose their party name.' : ''}`)) return;
    try { await deleteParty(p.id); toast(`${p.name} deleted`, 'success'); }
    catch (e) { toast(`Couldn't delete ${p.name}: ${e.message}${/foreign key|violates/i.test(e.message) ? ' — they are still used on a delivery challan.' : ''}`, 'error'); }
    reload();
  }
  // Outstanding per party (receivable for clients, payable for vendors)
  const balByParty = useMemo(() => {
    const pays = {}; (payments || []).forEach(x => { (pays[x.invoice_id] ||= []).push(x); });
    const cns = {}; (creditNotes || []).forEach(x => { (cns[x.invoice_id] ||= []).push(x); });
    const m = {};
    (invoices || []).forEach(i => {
      if (['cancelled', 'proforma'].includes(i.status) || (i.type === 'sale' && i.status === 'draft')) return;
      m[i.party_id] = (m[i.party_id] || 0) + Math.max(0, invoiceDue(i, pays[i.id] || [], cns[i.id] || []));
    });
    return m;
  }, [invoices, payments, creditNotes]);

  return (
    <>
      <div className="filter-bar">
        <input placeholder="Search name, GSTIN…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option><option value="client">Clients</option><option value="vendor">Vendors</option><option value="employee">Employees</option>
        </select>
        <button className="btn btn-primary" onClick={() => { setEditData(null); setShowModal(true); }}>+ Add Party</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>State</th><th>GSTIN</th><th>Business</th><th className="r">Outstanding</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td><Badge status={p.type} /></td>
                <td className="mono" style={{ fontSize: 11 }}>{p.phone || '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--text2)' }}>{p.state || '—'}</td>
                <td className="mono" style={{ fontSize: 10, color: p.gstin && !isGSTINValid(p.gstin) ? 'var(--red)' : 'var(--text3)' }} title={p.gstin && !isGSTINValid(p.gstin) ? 'GSTIN failed the format/checksum test' : undefined}>{p.gstin || '—'}{p.gstin && !isGSTINValid(p.gstin) ? ' ⚠' : ''}</td>
                <td style={{ fontSize: 11, color: 'var(--text3)' }}>{businesses.find(b => b.id === p.business_id)?.name || '—'}</td>
                <td className="r mono" style={{ fontSize: 11.5, color: balByParty[p.id] > 0.01 ? (p.type === 'vendor' ? 'var(--red)' : 'var(--amber)') : 'var(--text3)' }}>{balByParty[p.id] > 0.01 ? fmt(balByParty[p.id]) : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditData(p); setShowModal(true); }}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => del(p)}>Del</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8}><EmptyState icon="👥" message="No parties found" sub={search || typeFilter ? 'Try clearing the search' : 'Add your clients and suppliers — set their State so GST splits correctly'} /></td></tr>}
          </tbody>
        </table>
      </div>
      {showModal && <PartyModal onClose={() => setShowModal(false)} onSave={save} businesses={businesses} parties={parties} editData={editData} activeBiz={activeBiz} defaultType={typeFilter || 'client'} />}
    </>
  );
}

const STATE_BY_CODE = Object.fromEntries(Object.entries(STATE_CODES).map(([s, c]) => [c, s]));

function PartyModal({ onClose, onSave, businesses, parties = [], editData, activeBiz, defaultType = 'client' }) {
  const [f, setF] = useState({
    business_id: editData?.business_id || activeBiz || businesses[0]?.id || '',
    name: editData?.name || '', type: editData?.type || defaultType,
    phone: editData?.phone || '', email: editData?.email || '',
    gstin: editData?.gstin || '', state: editData?.state || '', pan: editData?.pan || '',
    address: editData?.address || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // A GSTIN already contains the state (first 2 digits) and the PAN (next 10),
  // so typing it fills both in — and catches typos with the checksum test.
  function setGSTIN(v) {
    const g = v.toUpperCase().replace(/\s/g, '');
    setF(x => {
      const next = { ...x, gstin: g };
      if (g.length === 15) {
        const st = STATE_BY_CODE[g.slice(0, 2)];
        if (st && !x.state) next.state = st;
        if (!x.pan) next.pan = g.slice(2, 12);
      }
      return next;
    });
  }
  const gstinBad = f.gstin.trim().length > 0 && !isGSTINValid(f.gstin);
  const gstinState = f.gstin.length >= 2 ? STATE_BY_CODE[f.gstin.slice(0, 2)] : null;
  const stateMismatch = gstinState && f.state && gstinState !== f.state;

  // Duplicate guard — same GSTIN or phone already on another party in this
  // business almost always means the same real-world party is being entered
  // twice (or a typo carried over), which then splits their invoice/payment
  // history across two records. Warns, doesn't block — two genuinely
  // different divisions sharing one phone number does happen occasionally.
  const norm = s => (s || '').replace(/\D/g, '');
  const dupGSTIN = f.gstin.trim() && parties.find(p => p.id !== editData?.id && p.business_id === f.business_id && p.gstin && p.gstin.trim().toUpperCase() === f.gstin.trim().toUpperCase());
  const dupPhone = norm(f.phone).length >= 10 && parties.find(p => p.id !== editData?.id && p.business_id === f.business_id && norm(p.phone) === norm(f.phone));

  async function save() {
    if (!f.name.trim()) { setErr('Name is required'); return; }
    if (gstinBad && !confirm("This GSTIN doesn't pass the format/checksum check. Save it anyway?")) return;
    if ((dupGSTIN || dupPhone) && !confirm(`This ${dupGSTIN ? 'GSTIN' : 'phone number'} is already used by "${(dupGSTIN || dupPhone).name}". Save anyway as a separate party?`)) return;
    setBusy(true); setErr('');
    try { await onSave({ ...f, name: f.name.trim() }, editData?.id); onClose(); }
    catch (e) { setErr(e.message || 'Save failed'); }
    setBusy(false);
  }
  return (
    <ModalShell title={editData ? 'Edit Party' : 'Add Party'} onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-row cols-2">
        <FG label="Business"><select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value }))}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></FG>
        <FG label="Type"><select value={f.type} onChange={e => setF(x => ({ ...x, type: e.target.value }))}><option value="client">Client</option><option value="vendor">Vendor</option><option value="employee">Employee</option></select></FG>
      </div>
      <div className="form-row"><FG label="Name *"><input autoFocus value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></FG></div>
      <div className="form-row cols-2">
        <FG label="Phone"><input value={f.phone} onChange={e => setF(x => ({ ...x, phone: e.target.value }))} /></FG>
        <FG label="Email"><input value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} /></FG>
      </div>
      {dupPhone && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: -6, marginBottom: 8 }}>⚠ This phone number is already on "{dupPhone.name}" — likely the same party.</div>}
      <div className="form-row cols-3">
        <FG label="GSTIN" note={f.gstin.length === 15 && !gstinBad ? '✓ valid — state & PAN filled from it' : 'Fills State and PAN automatically'}>
          <input value={f.gstin} maxLength={15} onChange={e => setGSTIN(e.target.value)} placeholder="07AAXFN6403D1Z5"
            style={gstinBad && f.gstin.length >= 15 ? { borderColor: 'var(--red)' } : undefined} /></FG>
        <FG label="PAN"><input value={f.pan} onChange={e => setF(x => ({ ...x, pan: e.target.value.toUpperCase() }))} placeholder="ABCDE1234F" /></FG>
        <FG label="State (Place of Supply)"><select value={f.state} onChange={e => setF(x => ({ ...x, state: e.target.value }))}><option value="">Select…</option>{INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}</select></FG>
      </div>
      {dupGSTIN && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: -6, marginBottom: 8 }}>⚠ This GSTIN is already on "{dupGSTIN.name}" — likely the same party.</div>}
      {gstinBad && f.gstin.length >= 15 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: -6, marginBottom: 8 }}>⚠ GSTIN fails the checksum — check for a typo. A wrong GSTIN blocks the buyer's input credit.</div>}
      {stateMismatch && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: -6, marginBottom: 8 }}>⚠ GSTIN is registered in {gstinState}, but State is set to {f.state}. Place of supply decides CGST/SGST vs IGST.</div>}
      <FG label="Address"><textarea value={f.address} onChange={e => setF(x => ({ ...x, address: e.target.value }))} /></FG>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── AR LEDGER ────────────────────────────────────────────────────────────────
export function ARLedgerView({ invoices, payments, creditNotes, debitNotes = [], parties, businesses, activeBiz, setView }) {
  const [selectedParty, setSelectedParty] = useState('');
  const [agingTab, setAgingTab] = useState('ledger');

  const clients = parties.filter(p => p.type === 'client' && (activeBiz ? p.business_id === activeBiz : true));
  const paysByInv = {};
  payments.forEach(p => { if (!paysByInv[p.invoice_id]) paysByInv[p.invoice_id] = []; paysByInv[p.invoice_id].push(p); });

  const clientSummaries = clients.map(c => {
    // Cancelled invoices and un-issued drafts aren't owed; they used to be counted.
    const cInvs = invoices.filter(i => i.party_id === c.id && i.type === 'sale' && !['proforma', 'cancelled', 'draft'].includes(i.status));
    const totalBilled = cInvs.reduce((s, i) => s + Number(i.total), 0);
    const totalPaid = cInvs.reduce((s, i) => (paysByInv[i.id] || []).reduce((ps, p) => ps + Number(p.amount), 0) + s, 0);
    const tdsTotal = cInvs.reduce((s, i) => s + Number(i.tds_amount || 0), 0);
    const balance = totalBilled - totalPaid - tdsTotal;
    const cCNs = creditNotes.filter(cn => cn.party_id === c.id && cn.status !== 'cancelled');
    const cnTotal = cCNs.reduce((s, cn) => s + Number(cn.total || 0), 0);
    const cDNs = debitNotes.filter(dn => dn.party_id === c.id && dn.status !== 'cancelled');
    const dnTotal = cDNs.reduce((s, dn) => s + Number(dn.total || 0), 0);
    const netBalance = balance - cnTotal + dnTotal;
    // Aging
    const now = new Date();
    let aging0 = 0, aging30 = 0, aging60 = 0, aging90 = 0;
    cInvs.filter(i => i.status !== 'paid').forEach(i => {
      const bal = invoiceDue(i, paysByInv[i.id] || [], cCNs.filter(cn => cn.invoice_id === i.id));
      if (bal <= 0) return;
      const days = i.due_date ? Math.floor((now - new Date(i.due_date)) / 86400000) : 0;
      if (days <= 0) aging0 += bal;
      else if (days <= 30) aging30 += bal;
      else if (days <= 60) aging60 += bal;
      else aging90 += bal;
    });
    return { ...c, totalBilled, totalPaid, balance, cnTotal, dnTotal, netBalance, aging0, aging30, aging60, aging90 };
  });

  const grandBalance = clientSummaries.reduce((s, c) => s + c.netBalance, 0);
  const selectedData = selectedParty ? clientSummaries.find(c => c.id === selectedParty) : null;
  const selectedInvs = selectedParty ? invoices.filter(i => i.party_id === selectedParty && i.type === 'sale' && !['proforma', 'cancelled', 'draft'].includes(i.status)) : [];

  return (
    <div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard label="Total Receivable" value={fmt(grandBalance)} color="amber" sub={`${clients.length} clients`} />
        <StatCard label="Overdue" value={fmt(clientSummaries.reduce((s, c) => s + c.aging30 + c.aging60 + c.aging90, 0))} color="red" sub="past due date (any age)" />
        <StatCard label="Current (not due)" value={fmt(clientSummaries.reduce((s, c) => s + c.aging0, 0))} color="green" sub="within terms" />
      </div>

      <div className="two-col" style={{ alignItems: 'flex-start' }}>
        <div className="table-wrap">
          <div className="table-toolbar"><h3>Client Balances</h3><span className="hint">Click a client for their statement & aging</span></div>
          <table>
            <thead><tr><th>Client</th><th className="r">Billed</th><th className="r">Paid</th><th className="r">Overdue</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {clientSummaries.filter(c => c.totalBilled > 0 || Math.abs(c.netBalance) > 0.01).sort((a, b) => b.netBalance - a.netBalance).map(c => (
                <tr key={c.id} style={{ cursor: 'pointer', background: selectedParty === c.id ? 'var(--bg3)' : '' }} onClick={() => setSelectedParty(selectedParty === c.id ? '' : c.id)}>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td className="r mono" style={{ fontSize: 11 }}>{fmt(c.totalBilled)}</td>
                  <td className="r mono" style={{ fontSize: 11, color: 'var(--green)' }}>{fmt(c.totalPaid)}</td>
                  <td className="r mono" style={{ fontSize: 11, color: 'var(--red)' }}>{c.aging30 + c.aging60 + c.aging90 > 0.01 ? fmt(c.aging30 + c.aging60 + c.aging90) : '—'}</td>
                  <td className="r mono" style={{ fontSize: 12, fontWeight: 600, color: c.netBalance > 0.01 ? 'var(--amber)' : 'var(--text3)' }}>{fmt(c.netBalance)}</td>
                </tr>
              ))}
              {clientSummaries.filter(c => c.totalBilled > 0).length === 0 && <tr><td colSpan={5}><EmptyState icon="🧾" message="No receivable data" sub="Issued sale invoices for clients show up here" /></td></tr>}
            </tbody>
          </table>
        </div>

        {selectedData && (
          <div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-head">{selectedData.name} — Statement</div>
              {selectedInvs.map(inv => {
                const paid = (paysByInv[inv.id] || []).reduce((s, p) => s + Number(p.amount), 0);
                const bal = invoiceDue(inv, paysByInv[inv.id] || [], creditNotes.filter(cn => cn.invoice_id === inv.id));
                const invPays = (paysByInv[inv.id] || []).slice().sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date));
                return (
                  <div key={inv.id} className="ledger-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 12 }}>{inv.invoice_number}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{fmtDate(inv.issue_date)} · Due {fmtDate(inv.due_date)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{fmt(inv.total)}</div>
                        {paid > 0 && <div style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)' }}>-{fmt(paid)}</div>}
                        <div style={{ fontSize: 11, fontWeight: 600, color: bal > 0.01 ? 'var(--amber)' : 'var(--green)', fontFamily: 'var(--mono)' }}>{bal > 0.01 ? fmt(bal) : '✓ Paid'}</div>
                      </div>
                    </div>
                    {invPays.length > 0 && (
                      <div style={{ paddingLeft: 10, borderLeft: '2px solid var(--border2)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {invPays.map(p => (
                          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text2)' }}>
                            <span>{fmtDate(p.payment_date)} · {p.method || '—'}{p.reference ? ` · ${p.reference}` : ''}</span>
                            <span style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmt(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="ledger-row total">
                <span>Net Balance Due</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{fmt(selectedData.netBalance)}</span>
              </div>
            </div>
            {/* Aging */}
            <div className="card">
              <div className="card-head">Aging Analysis</div>
              {[['Not due', selectedData.aging0, 'var(--green)'], ['1-30 days', selectedData.aging30, 'var(--amber)'], ['31-60 days', selectedData.aging60, 'var(--red)'], ['60+ days', selectedData.aging90, 'var(--red)']].map(([lbl, val, clr]) => (
                <div key={lbl} className="ledger-row">
                  <span style={{ fontSize: 12 }}>{lbl}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: val > 0 ? clr : 'var(--text3)' }}>{val > 0 ? fmt(val) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AP LEDGER ────────────────────────────────────────────────────────────────
// What you owe suppliers = purchase bills − payments made against them. The old
// screen added bills + expenses and never subtracted payments, so "Total Owed"
// only ever grew. Expenses are recorded as already paid (they carry a payment
// method), so they're shown for reference but never counted as owed.
export function APLedgerView({ invoices, expenses, payments, parties, businesses, activeBiz, debitNotes = [] }) {
  const [selected, setSelected] = useState('');
  const vendors = parties.filter(p => (activeBiz ? p.business_id === activeBiz : true));
  const paysByInv = {};
  payments.forEach(p => { (paysByInv[p.invoice_id] ||= []).push(p); });
  const now = today();

  const vendorSummaries = vendors.map(v => {
    const bills = invoices.filter(i => i.party_id === v.id && i.type === 'purchase' && i.status !== 'cancelled');
    const billed = bills.reduce((s, i) => s + Number(i.total || 0), 0);
    const paid = bills.reduce((s, i) => s + (paysByInv[i.id] || []).reduce((a, p) => a + Number(p.amount || 0), 0), 0);
    const balance = bills.reduce((s, i) => s + Math.max(0, invoiceDue(i, paysByInv[i.id] || [])), 0);
    const overdue = bills.filter(i => i.due_date && i.due_date < now).reduce((s, i) => s + Math.max(0, invoiceDue(i, paysByInv[i.id] || [])), 0);
    const directExp = expenses.filter(e => e.vendor_id === v.id).reduce((s, e) => s + Number(e.amount || 0), 0);
    return { ...v, bills, billed, paid, balance, overdue, directExp };
  }).filter(v => v.billed > 0 || v.directExp > 0);

  const totals = vendorSummaries.reduce((t, v) => ({ billed: t.billed + v.billed, paid: t.paid + v.paid, balance: t.balance + v.balance, overdue: t.overdue + v.overdue, directExp: t.directExp + v.directExp }), { billed: 0, paid: 0, balance: 0, overdue: 0, directExp: 0 });
  const sel = vendorSummaries.find(v => v.id === selected);

  return (
    <div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard label="Total Payable" value={fmt(totals.balance)} color="red" sub="bills − payments made" />
        <StatCard label="Overdue to suppliers" value={fmt(totals.overdue)} color="amber" sub="past the bill's due date" />
        <StatCard label="Purchase Bills" value={fmt(totals.billed)} color="blue" sub={`paid ${fmt(totals.paid)}`} />
        <StatCard label="Direct Expenses" value={fmt(totals.directExp)} color="purple" sub="already paid — not owed" />
      </div>
      <div className="two-col" style={{ alignItems: 'flex-start' }}>
        <div className="table-wrap">
          <div className="table-toolbar"><h3>Supplier Balances</h3><span className="hint">Click a supplier for their bills</span></div>
          <table>
            <thead><tr><th>Supplier</th><th className="r">Billed</th><th className="r">Paid</th><th className="r">Overdue</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {vendorSummaries.sort((a, b) => b.balance - a.balance).map(v => (
                <tr key={v.id} className="clickable" style={{ background: selected === v.id ? 'var(--bg3)' : '' }} onClick={() => setSelected(selected === v.id ? '' : v.id)}>
                  <td style={{ fontWeight: 500 }}>{v.name}</td>
                  <td className="r mono" style={{ fontSize: 11 }}>{fmt(v.billed)}</td>
                  <td className="r mono" style={{ fontSize: 11, color: 'var(--green)' }}>{fmt(v.paid)}</td>
                  <td className="r mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{v.overdue > 0.01 ? fmt(v.overdue) : '—'}</td>
                  <td className="r mono" style={{ fontSize: 12, fontWeight: 600, color: v.balance > 0.01 ? 'var(--red)' : 'var(--text3)' }}>{v.balance > 0.01 ? fmt(v.balance) : '✓'}</td>
                </tr>
              ))}
              {vendorSummaries.length === 0 && <tr><td colSpan={5}><EmptyState icon="🏪" message="No payables yet" sub="Record supplier bills under Purchases → Purchase Bills" /></td></tr>}
            </tbody>
          </table>
        </div>
        {sel && (
          <div className="card">
            <div className="card-head">{sel.name} — Bills</div>
            {sel.bills.length === 0 && <div className="hint">No purchase bills — only direct expenses ({fmt(sel.directExp)}).</div>}
            {sel.bills.sort((a, b) => (a.issue_date || '').localeCompare(b.issue_date || '')).map(b => {
              const due = invoiceDue(b, paysByInv[b.id] || []);
              const late = b.due_date && b.due_date < now && due > 0.01;
              return (
                <div key={b.id} className="ledger-row">
                  <div>
                    <div className="mono" style={{ fontSize: 12 }}>{b.invoice_number}</div>
                    <div className="hint">{fmtDate(b.issue_date)} · due {fmtDate(b.due_date)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="mono" style={{ fontSize: 12 }}>{fmt(b.total)}</div>
                    <div className="mono" style={{ fontSize: 11, fontWeight: 600, color: due <= 0.01 ? 'var(--green)' : late ? 'var(--red)' : 'var(--amber)' }}>{due <= 0.01 ? '✓ Paid' : `${fmt(due)} due${late ? ' · late' : ''}`}</div>
                  </div>
                </div>
              );
            })}
            <div className="ledger-row total"><span>Balance</span><span className="mono" style={{ color: 'var(--red)' }}>{fmt(sel.balance)}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── EXPENSES VIEW ────────────────────────────────────────────────────────────
export function ExpensesView({ expenses, businesses, parties, activeBiz, reload, accounts, journalEntries, journalLines, invoices }) {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [tallyResults, setTallyResults] = useState({}); // id -> tally result, set once Tally has run

  const [month, setMonth] = useState('');
  const bizExp = expenses.filter(e => (activeBiz ? e.business_id === activeBiz : true));
  const months = [...new Set(bizExp.map(e => (e.expense_date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const filtered = bizExp.filter(e => {
    const q = search.toLowerCase();
    const payee = parties.find(p => p.id === e.vendor_id)?.name || '';
    return (!month || (e.expense_date || '').startsWith(month))
      && (!q || e.category.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q) || payee.toLowerCase().includes(q));
  });
  const filteredTotal = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);

  const [saveErr, setSaveErr] = useState('');
  async function save(data) {
    setSaveErr('');
    // Errors propagate to the modal so it stays open and shows them.
    const res = await saveExpenseWithJournal(data);
    if (res?.skipped) toast(`Expense saved, but no journal entry was posted (${res.skipReason === 'account_not_found' ? `no ledger matching "${data.category}" or Bank/Cash in the Chart of Accounts` : res.skipReason}). Re-post it from Journal Health.`, 'warn', 9000);
    else toast('Expense saved', 'success');
    reload();
  }
  async function del(e) {
    if (!confirm(`Delete this ${e.category} expense of ${fmt(e.amount)}? Its journal entry is removed too.`)) return;
    try { await deleteExpense(e.id, e.attachment_path); toast('Expense deleted', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    reload();
  }

  function runTally() {
    const results = {};
    for (const e of filtered) results[e.id] = tallyExpense(e, journalEntries, journalLines, accounts);
    setTallyResults(results);
    alert(tallyAlertText(tallySummary(results), 'Expenses'));
  }

  async function viewAttachment(path) {
    try {
      const url = await getExpenseAttachmentUrl(path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      alert('Could not open attachment: ' + (e.message || 'unknown error'));
    }
  }

  return (
    <>
      <div className="filter-bar">
        <input placeholder="Search category, description, payee…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={month} onChange={e => setMonth(e.target.value)}>
          <option value="">All months</option>
          {months.map(m => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</option>)}
        </select>
        <button className="btn btn-ghost" onClick={runTally} disabled={!filtered.length}
          title="Check every expense's date and amount against its journal entry">🔎 Tally</button>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Expense</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Payee</th><th>Method</th><th>Ref</th><th className="r">Amount</th><th>Bill</th><th>Journal</th><th></th></tr></thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id}>
                <td className="mono" style={{ fontSize: 11 }}>{fmtDate(e.expense_date)}</td>
                <td style={{ fontSize: 12 }}>{e.category}</td>
                <td style={{ fontSize: 11, color: 'var(--text2)' }}>{e.description || '—'}</td>
                <td style={{ fontSize: 12 }}>{parties.find(p => p.id === e.vendor_id)?.name || '—'}</td>
                <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{e.method}</td>
                <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{e.reference || '—'}</td>
                <td className="r mono" style={{ color: 'var(--red)' }}>{fmt(e.amount)}</td>
                <td style={{ textAlign: 'center' }}>
                  {e.attachment_path
                    ? <button className="btn btn-ghost btn-sm" onClick={() => viewAttachment(e.attachment_path)} title={e.attachment_name || 'View attachment'}>📎</button>
                    : <span style={{ fontSize: 10, color: 'var(--text4)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {tallyResults[e.id]
                    ? <TallyBadge result={tallyResults[e.id]} />
                    : journalEntries.some(je => je.source === 'expense' && je.source_id === e.id)
                      ? <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)' }}>✓</span>
                      : <span style={{ fontSize: 10, color: 'var(--text4)', fontFamily: 'var(--mono)' }} title="No matching journal entry — see Journal Health">—</span>}
                </td>
                <td><button className="btn btn-danger btn-sm" onClick={() => del(e)}>Del</button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10}><EmptyState icon="💸" message="No expenses" sub={search || month ? 'Nothing matches this search / month' : 'Click "+ Add Expense" to record one'} /></td></tr>}
          </tbody>
          {filtered.length > 0 && <tfoot><tr style={{ background: 'var(--bg3)' }}>
            <td colSpan={6} className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{filtered.length} expense{filtered.length === 1 ? '' : 's'}</td>
            <td className="r mono" style={{ fontWeight: 600, color: 'var(--red)' }}>{fmt(filteredTotal)}</td><td colSpan={3}></td>
          </tr></tfoot>}
        </table>
      </div>
      {saveErr && <p className="err-msg" style={{ marginBottom: 8 }}>{saveErr}</p>}
      {showModal && <ExpenseModal onClose={() => setShowModal(false)} onSave={save} businesses={businesses} parties={parties} activeBiz={activeBiz} expenses={expenses} />}
    </>
  );
}

function ExpenseModal({ onClose, onSave, businesses, parties, activeBiz, expenses }) {
  const [f, setF] = useState({ business_id: activeBiz || businesses[0]?.id || '', category: '', description: '', amount: '', expense_date: today(), vendor_id: '', method: 'UPI', reference: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dupConfirmed, setDupConfirmed] = useState(false);
  const vendors = parties.filter(p => p.type === 'vendor' && p.business_id === f.business_id);
  const employees = parties.filter(p => p.type === 'employee' && p.business_id === f.business_id);

  useEffect(() => { setDupConfirmed(false); }, [f.business_id, f.category, f.vendor_id, f.expense_date, f.amount]);

  const dupWarning = useMemo(() => {
    if (!f.category || !f.amount || Number(f.amount) <= 0) return null;
    return findDuplicateExpense(f, expenses || []);
  }, [f, expenses]);

  async function save() {
    if (!f.category) { setErr('Category is required'); return; }
    if (!f.amount || Number(f.amount) <= 0) { setErr('Enter a valid amount'); return; }
    if (dupWarning && !dupConfirmed) {
      const vendorName = parties.find(p => p.id === dupWarning.vendor_id)?.name;
      setErr(`An expense on ${dupWarning.expense_date} for ₹${Number(dupWarning.amount).toFixed(2)} in "${dupWarning.category}"${vendorName ? ` (${vendorName})` : ''} already exists. Click Save again to add this one anyway.`);
      setDupConfirmed(true);
      return;
    }
    setBusy(true); setErr('');
    try {
      let attachment_path = null, attachment_name = null;
      if (file) {
        attachment_path = await uploadExpenseAttachment(file, f.business_id);
        attachment_name = file.name;
      }
      await onSave({ ...f, attachment_path, attachment_name });
      onClose();
    }
    catch (e) { setErr(e.message || 'Save failed — check Supabase connection'); }
    setBusy(false);
  }
  return (
    <ModalShell title="Add Expense" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-row cols-2">
        <FG label="Business"><select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value, vendor_id: '' }))}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></FG>
        <FG label="Category *"><select value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))}><option value="">Select…</option>{EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Amount (₹) *"><input type="number" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} /></FG>
        <FG label="Date *"><input type="date" value={f.expense_date} onChange={e => setF(x => ({ ...x, expense_date: e.target.value }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Payee (Vendor / Employee)">
          <select value={f.vendor_id} onChange={e => setF(x => ({ ...x, vendor_id: e.target.value }))}>
            <option value="">None</option>
            {vendors.length > 0 && <optgroup label="Vendors">{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>}
            {employees.length > 0 && <optgroup label="Employees">{employees.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>}
          </select>
        </FG>
        <FG label="Method"><select value={f.method} onChange={e => setF(x => ({ ...x, method: e.target.value }))}>{PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}</select></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Reference / UTR"><input value={f.reference} onChange={e => setF(x => ({ ...x, reference: e.target.value }))} /></FG>
        <FG label="Description"><input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} /></FG>
      </div>
      <FG label="Attach Bill / Receipt (image or PDF)">
        <input type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} />
      </FG>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── BANK RECONCILIATION ─────────────────────────────────────────────────────
export function BankView({ bankAccounts, bankTransactions, businesses, parties, invoices, payments, accounts, bankLinks = [], activeBiz, reload }) {
  const [selectedBank, setSelectedBank] = useState('');
  const [showAddBank, setShowAddBank] = useState(false);
  const [showAddTxn, setShowAddTxn] = useState(false);

  const filteredBanks = activeBiz ? bankAccounts.filter(b => b.business_id === activeBiz) : bankAccounts;
  const bankTxns = selectedBank ? bankTransactions.filter(t => t.bank_account_id === selectedBank) : [];
  const selBank = filteredBanks.find(b => b.id === selectedBank);

  const balance = bankTxns.reduce((s, t) => s + (t.type === 'credit' ? Number(t.amount) : -Number(t.amount)), selBank?.opening_balance || 0);
  const reconciledCount = bankTxns.filter(t => t.reconciled).length;

  async function saveBank(data, id) { await saveBankAccount(data, id); reload(); }
  async function addTxn(data) {
    // Was calling the plain insert (no journal) — inconsistent with the PDF
    // import path, which auto-posts. Route through the same posting logic so
    // a manually-added transaction isn't silently invisible everywhere else.
    const result = await saveBankTxnWithJournal({
      bankAccountId: data.bank_account_id,
      date: data.txn_date,
      description: data.description,
      reference: data.reference,
      type: data.type,
      amount: data.amount,
    }, accounts, selBank?.business_id || activeBiz);
    if (result.skipped) {
      alert(`Transaction saved, but couldn't post to the journal yet — ${result.skipReason === 'account_not_found' ? 'a required account is missing from Chart of Accounts' : result.skipReason}. You can re-post it from Journal Health once that's fixed.`);
    }
    reload();
  }
  async function delTxn(id) { if (!confirm('Delete?')) return; await deleteBankTxn(id); reload(); }

  const linkedAmt = {};
  bankLinks.forEach(l => { linkedAmt[l.bank_txn_id] = (linkedAmt[l.bank_txn_id] || 0) + Number(l.amount || 0); });

  return (
    <div>
      <div className="filter-bar">
        <select value={selectedBank} onChange={e => setSelectedBank(e.target.value)} style={{ minWidth: 200, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          <option value="">Select bank account…</option>
          {filteredBanks.map(b => <option key={b.id} value={b.id}>{b.name} — {b.account_number}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowAddBank(true)}>+ Add Bank</button>
        {selectedBank && <button className="btn btn-ghost btn-sm" onClick={() => setShowAddTxn(true)}>+ Add Transaction</button>}
      </div>

      {selBank && (
        <>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 14 }}>
            <StatCard label="Current Balance" value={fmt(balance)} color={balance >= 0 ? 'green' : 'red'} sub={selBank.bank_name} />
            <StatCard label="Opening Balance" value={fmt(selBank.opening_balance || 0)} color="blue" />
            <StatCard label="Transactions" value={bankTxns.length} color="purple" />
            <StatCard label="Reconciled" value={`${reconciledCount} / ${bankTxns.length}`} color="green" sub="from imports" />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th>Type</th><th className="r">Amount</th><th className="r">Balance</th><th title="Credits tied to an invoice / proforma payment (Bank Receipts)">Linked</th><th></th></tr></thead>
              <tbody>
                {(() => {
                  let runBal = selBank.opening_balance || 0;
                  return bankTxns.map(t => {
                    runBal += t.type === 'credit' ? Number(t.amount) : -Number(t.amount);
                    return (
                      <tr key={t.id}>
                        <td className="mono" style={{ fontSize: 11 }}>{fmtDate(t.txn_date)}</td>
                        <td style={{ fontWeight: 500, fontSize: 12.5 }}>{t.description}</td>
                        <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{t.reference || '—'}</td>
                        <td><span className={`tag`} style={{ color: t.type === 'credit' ? 'var(--green)' : 'var(--red)', borderColor: t.type === 'credit' ? 'var(--green)' : 'var(--red)' }}>{t.type}</span></td>
                        <td className="r mono" style={{ color: t.type === 'credit' ? 'var(--green)' : 'var(--red)' }}>{t.type === 'credit' ? '+' : '-'}{fmt(t.amount)}</td>
                        <td className="r mono" style={{ fontWeight: 600, color: runBal >= 0 ? 'var(--text)' : 'var(--red)' }}>{fmt(runBal)}</td>
                        <td style={{ fontSize: 11 }}>
                          {t.type !== 'credit' ? '' : t.link_dismissed ? <span style={{ color: 'var(--text3)' }}>not a receipt</span>
                            : linkedAmt[t.id] > 0 ? <span style={{ color: linkedAmt[t.id] >= Number(t.amount) - 0.01 ? '#4ade80' : '#fbbf24' }}>{linkedAmt[t.id] >= Number(t.amount) - 0.01 ? '🔗 linked' : '🔗 part'}</span>
                            : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                        <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {t.reconciled && <span title="Imported from bank statement" style={{ color: '#4ade80', fontSize: 14 }}>●</span>}
                          <button className="btn btn-danger btn-sm" onClick={() => delTxn(t.id)}>Del</button>
                        </td>
                      </tr>
                    );
                  });
                })()}
                {bankTxns.length === 0 && <tr><td colSpan={8}><EmptyState icon="🏦" message="No transactions" /></td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!selectedBank && filteredBanks.length === 0 && <EmptyState icon="🏦" message="No bank accounts added" sub='Click "+ Add Bank" to get started' />}
      {!selectedBank && filteredBanks.length > 0 && <EmptyState icon="👆" message="Select a bank account above" />}

      {showAddBank && <BankModal onClose={() => setShowAddBank(false)} onSave={saveBank} businesses={businesses} activeBiz={activeBiz} />}
      {showAddTxn && <BankTxnModal onClose={() => setShowAddTxn(false)} onSave={addTxn} bankAccountId={selectedBank} />}
    </div>
  );
}

function BankModal({ onClose, onSave, businesses, activeBiz }) {
  const [f, setF] = useState({ business_id: activeBiz || businesses[0]?.id || '', name: '', bank_name: '', account_number: '', ifsc_code: '', opening_balance: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    if (!f.name.trim()) { setErr('Label is required'); return; }
    setBusy(true); setErr('');
    try { await onSave(f); onClose(); }
    catch (e) { setErr(e.message || 'Save failed — check Supabase connection'); }
    setBusy(false);
  }
  return (
    <ModalShell title="Add Bank Account" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-row cols-2">
        <FG label="Label *"><input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="e.g. ICICI Current" /></FG>
        <FG label="Bank Name"><input value={f.bank_name} onChange={e => setF(x => ({ ...x, bank_name: e.target.value }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Account Number"><input value={f.account_number} onChange={e => setF(x => ({ ...x, account_number: e.target.value }))} /></FG>
        <FG label="IFSC Code"><input value={f.ifsc_code} onChange={e => setF(x => ({ ...x, ifsc_code: e.target.value.toUpperCase() }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Opening Balance (₹)"><input type="number" value={f.opening_balance} onChange={e => setF(x => ({ ...x, opening_balance: e.target.value }))} /></FG>
        <FG label="Business"><select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value }))}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></FG>
      </div>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

function BankTxnModal({ onClose, onSave, bankAccountId }) {
  const [f, setF] = useState({ bank_account_id: bankAccountId, txn_date: today(), description: '', reference: '', type: 'credit', amount: '', reconciled: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    if (!f.description.trim()) { setErr('Description is required'); return; }
    if (!f.amount || Number(f.amount) <= 0) { setErr('Enter a valid amount'); return; }
    setBusy(true); setErr('');
    try { await onSave({ ...f, amount: Number(f.amount) }); onClose(); }
    catch (e) { setErr(e.message || 'Save failed — check Supabase connection'); }
    setBusy(false);
  }
  return (
    <ModalShell title="Add Bank Transaction" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-row cols-2">
        <FG label="Date"><input type="date" value={f.txn_date} onChange={e => setF(x => ({ ...x, txn_date: e.target.value }))} /></FG>
        <FG label="Type"><select value={f.type} onChange={e => setF(x => ({ ...x, type: e.target.value }))}><option value="credit">Credit (money in)</option><option value="debit">Debit (money out)</option></select></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Amount *"><input type="number" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} /></FG>
        <FG label="Reference / UTR"><input value={f.reference} onChange={e => setF(x => ({ ...x, reference: e.target.value }))} /></FG>
      </div>
      <FG label="Description *"><input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} placeholder="e.g. Payment from client" /></FG>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── PAYMENTS VIEW ────────────────────────────────────────────────────────────
export function PaymentsView({ payments, businesses, parties, invoices, activeBiz, reload, journalEntries, journalLines }) {
  const [tallyResults, setTallyResults] = useState({}); // id -> tally result, set once Tally has run
  const [search, setSearch] = useState('');
  const [dir, setDir] = useState(''); // '' | 'in' | 'out'
  const invById = useMemo(() => Object.fromEntries(invoices.map(i => [i.id, i])), [invoices]);
  const filtered = (activeBiz ? payments.filter(p => p.business_id === activeBiz) : payments).filter(p => {
    const inv = invById[p.invoice_id];
    if (dir === 'in' && inv?.type === 'purchase') return false;
    if (dir === 'out' && inv?.type !== 'purchase') return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const party = parties.find(pt => pt.id === p.party_id)?.name || '';
    return [party, inv?.invoice_number, p.reference, p.method].some(v => (v || '').toLowerCase().includes(q));
  });
  const totalIn = filtered.filter(p => invById[p.invoice_id]?.type !== 'purchase').reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalOut = filtered.filter(p => invById[p.invoice_id]?.type === 'purchase').reduce((s, p) => s + Number(p.amount || 0), 0);

  async function del(id, invId) {
    if (!confirm('Delete this payment? Its journal entry is removed and the invoice status recalculated.')) return;
    try {
      await deletePayment(id);
      // Recalc invoice status. A proforma stays a proforma; with nothing left
      // paid an issued invoice goes back to "sent" (purchase bills likewise).
      const inv = invoices.find(i => i.id === invId);
      if (inv && !['proforma', 'cancelled', 'draft'].includes(inv.status)) {
        const remaining = payments.filter(p => p.id !== id && p.invoice_id === invId);
        const due = invoiceDue(inv, remaining);
        const status = remaining.length === 0 ? 'sent' : due <= 0.01 ? 'paid' : 'partially_paid';
        if (status !== inv.status) await updateInvoiceStatus(invId, status);
      }
      toast('Payment deleted', 'success');
    } catch (e) { toast(e.message, 'error'); }
    reload();
  }

  function runTally() {
    const results = {};
    for (const p of filtered) results[p.id] = tallyPayment(p, journalEntries, journalLines);
    setTallyResults(results);
    alert(tallyAlertText(tallySummary(results), 'Payments'));
  }

  return (
    <>
      <div className="filter-bar">
        <input placeholder="Search party, invoice #, UTR…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={dir} onChange={e => setDir(e.target.value)}>
          <option value="">Received & paid</option><option value="in">Received (sales)</option><option value="out">Paid (purchase bills)</option>
        </select>
        <button className="btn btn-ghost" onClick={runTally} disabled={!filtered.length}
          title="Check every payment's date and amount against its journal entry">🔎 Tally</button>
      </div>
      <div className="sum-strip"><span>{filtered.length} payments</span><span>Received <b style={{ color: 'var(--green)' }}>{fmt(totalIn)}</b></span><span>Paid out <b style={{ color: 'var(--red)' }}>{fmt(totalOut)}</b></span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Party</th><th>Invoice</th><th>Method</th><th>Reference</th><th className="r">Amount</th><th>Journal</th><th></th></tr></thead>
          <tbody>
            {filtered.map(p => {
              const inv = invoices.find(i => i.id === p.invoice_id);
              return (
                <tr key={p.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtDate(p.payment_date)}</td>
                  <td style={{ fontWeight: 500 }}>{parties.find(pt => pt.id === p.party_id)?.name || '—'}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{inv?.invoice_number || '—'}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{p.method}</td>
                  <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{p.reference || '—'}</td>
                  <td className="r mono" style={{ color: inv?.type === 'purchase' ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>{inv?.type === 'purchase' ? '−' : ''}{fmt(p.amount)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <TallyBadge result={tallyResults[p.id]} />
                  </td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => del(p.id, p.invoice_id)}>Del</button></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8}><EmptyState icon="💳" message="No payments yet" /></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── GSTR-1 ───────────────────────────────────────────────────────────────────
export function GSTR1View({ invoices, parties, businesses, activeBiz }) {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(now.getFullYear()));

  const months = [['01','Jan'],['02','Feb'],['03','Mar'],['04','Apr'],['05','May'],['06','Jun'],['07','Jul'],['08','Aug'],['09','Sep'],['10','Oct'],['11','Nov'],['12','Dec']];
  const years = ['2023','2024','2025','2026','2027'];

  const saleInvoices = invoices.filter(i => {
    if (i.type !== 'sale' || i.status === 'proforma' || i.status === 'draft' || i.status === 'cancelled') return false;
    if (activeBiz && i.business_id !== activeBiz) return false;
    if (!i.issue_date) return false;
    const d = new Date(i.issue_date);
    return String(d.getMonth() + 1).padStart(2, '0') === month && String(d.getFullYear()) === year;
  });

  const biz = activeBiz ? businesses.find(b => b.id === activeBiz) : businesses[0];

  // B2B: invoices with a GSTIN — locked to each invoice's own snapshot
  // (see effectiveGstin in constants.js), not a live party lookup, so
  // adding a client's GSTIN later doesn't retroactively reclassify old
  // invoices you may have already filed.
  const b2b = saleInvoices.filter(i => { const p = parties.find(pt => pt.id === i.party_id); return effectiveGstin(i, p); });
  // B2C Large: no GSTIN, inter-state, invoice value > B2CL_THRESHOLD
  // (₹1L effective 1 Aug 2024, Notification 12/2024-CT — was ₹2.5L before that)
  const b2cLarge = saleInvoices.filter(i => { const p = parties.find(pt => pt.id === i.party_id); return !effectiveGstin(i, p) && i.is_interstate && Number(i.total) > B2CL_THRESHOLD; });
  // B2C Small: rest
  const b2cSmall = saleInvoices.filter(i => { const p = parties.find(pt => pt.id === i.party_id); return !effectiveGstin(i, p) && !(i.is_interstate && Number(i.total) > B2CL_THRESHOLD); });

  const totalTaxable = saleInvoices.reduce((s, i) => s + Number(i.subtotal || 0), 0);
  const totalCGST = saleInvoices.reduce((s, i) => s + Number(i.cgst_amount || 0), 0);
  const totalSGST = saleInvoices.reduce((s, i) => s + Number(i.sgst_amount || 0), 0);
  const totalIGST = saleInvoices.reduce((s, i) => s + Number(i.igst_amount || 0), 0);
  const totalTax = totalCGST + totalSGST + totalIGST;
  const grandTotal = totalTaxable + totalTax;

  // Export CSV for GSTR-1
  function exportCSV() {
    const rows = [['Invoice No.', 'Date', 'Party Name', 'GSTIN', 'State', 'State Code', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total', 'Supply Type']];
    saleInvoices.forEach(i => {
      const p = parties.find(pt => pt.id === i.party_id) || {};
      const sc = STATE_CODES[p.state] || '';
      rows.push([
        i.invoice_number, i.issue_date, p.name || '', effectiveGstin(i, p) || '', p.state || '', sc,
        i.subtotal, i.cgst_amount || 0, i.sgst_amount || 0, i.igst_amount || 0,
        i.total, i.is_interstate === false ? 'Intra-state' : 'Inter-state'
      ]);
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `GSTR1_${month}_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="filter-bar">
        <select value={month} onChange={e => setMonth(e.target.value)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          {months.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={year} onChange={e => setYear(e.target.value)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
      </div>

      {/* Summary */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Taxable Value" value={fmt(totalTaxable)} color="blue" sub={`${saleInvoices.length} invoices`} />
        <StatCard label="CGST + SGST" value={fmt(totalCGST + totalSGST)} color="purple" sub="Intra-state" />
        <StatCard label="IGST" value={fmt(totalIGST)} color="amber" sub="Inter-state" />
        <StatCard label="Total Tax" value={fmt(totalTax)} color="red" />
      </div>

      {/* B2B */}
      <div style={{ marginBottom: 16 }}>
        <div className="section-title">B2B Supplies (with GSTIN) — {b2b.length} invoice(s)</div>
        {b2b.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Invoice #</th><th>Date</th><th>Party</th><th>GSTIN</th><th>State</th><th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th><th className="r">Total</th></tr></thead>
              <tbody>
                {b2b.map(i => {
                  const p = parties.find(pt => pt.id === i.party_id) || {};
                  return (
                    <tr key={i.id}>
                      <td className="mono" style={{ color: 'var(--accent)' }}>{i.invoice_number}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{fmtDate(i.issue_date)}</td>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td className="mono" style={{ fontSize: 10 }}>{effectiveGstin(i, p)}</td>
                      <td style={{ fontSize: 11 }}>{p.state} <span className="tag">{STATE_CODES[p.state]}</span></td>
                      <td className="r mono">{fmt(i.subtotal)}</td>
                      <td className="r mono" style={{ color: 'var(--blue)', fontSize: 11 }}>{fmt(i.cgst_amount || 0)}</td>
                      <td className="r mono" style={{ color: 'var(--teal)', fontSize: 11 }}>{fmt(i.sgst_amount || 0)}</td>
                      <td className="r mono" style={{ color: 'var(--amber)', fontSize: 11 }}>{fmt(i.igst_amount || 0)}</td>
                      <td className="r mono" style={{ fontWeight: 600 }}>{fmt(i.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--mono)', padding: '8px 0' }}>No B2B invoices this period</div>}
      </div>

      {/* B2C Summary */}
      <div style={{ marginBottom: 16 }}>
        <div className="section-title">B2C Supplies (consumer / unregistered) — {b2cSmall.length + b2cLarge.length} invoice(s)</div>
        {(b2cSmall.length + b2cLarge.length) > 0 ? (
          <div className="card">
            <div className="ledger-row"><span>B2C Large (inter-state &gt;₹1L)</span><span className="mono">{b2cLarge.length} invoices · {fmt(b2cLarge.reduce((s, i) => s + Number(i.total), 0))}</span></div>
            <div className="ledger-row"><span>B2C Small (rest)</span><span className="mono">{b2cSmall.length} invoices · {fmt(b2cSmall.reduce((s, i) => s + Number(i.total), 0))}</span></div>
          </div>
        ) : <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--mono)', padding: '8px 0' }}>No B2C invoices this period</div>}
      </div>

      {/* Period totals */}
      <div className="card" style={{ marginTop: 4 }}>
        <div className="card-head">Period Summary — {months.find(([v]) => v === month)?.[1]} {year}</div>
        <div className="ledger-row"><span>Total Taxable Value</span><span className="mono">{fmt(totalTaxable)}</span></div>
        <div className="ledger-row"><span>CGST</span><span className="mono" style={{ color: 'var(--blue)' }}>{fmt(totalCGST)}</span></div>
        <div className="ledger-row"><span>SGST</span><span className="mono" style={{ color: 'var(--teal)' }}>{fmt(totalSGST)}</span></div>
        <div className="ledger-row"><span>IGST</span><span className="mono" style={{ color: 'var(--amber)' }}>{fmt(totalIGST)}</span></div>
        <div className="ledger-row total"><span>Total Tax</span><span className="mono" style={{ color: 'var(--red)' }}>{fmt(totalTax)}</span></div>
        <div className="ledger-row total" style={{ borderTop: '2px solid var(--border2)' }}><span style={{ fontSize: 14 }}>Grand Total</span><span className="mono" style={{ fontSize: 14 }}>{fmt(grandTotal)}</span></div>
      </div>
    </div>
  );
}
