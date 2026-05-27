import { useState, useMemo } from 'react';
import { fmt, fmtDate, today, getFY, PAY_MODES, GST_RATES, INDIAN_STATES, gstType, calcLineTax } from '../lib/constants.js';
import { savePayment, updateInvoiceStatus, saveInvoice } from '../lib/db.js';
import { Badge, ModalShell, FG, EmptyState } from '../components/ui.jsx';

// ─── AGING REPORT ─────────────────────────────────────────────────────────────

export function AgingView({ invoices, parties, payments, businesses, activeBiz }) {
  const [viewType, setViewType] = useState('receivable'); // receivable | payable

  const bi = activeBiz ? invoices.filter(i => i.business_id === activeBiz) : invoices;
  const paysByInv = {};
  payments.forEach(p => { if (!paysByInv[p.invoice_id]) paysByInv[p.invoice_id] = []; paysByInv[p.invoice_id].push(p); });

  const now = new Date();
  const daysDiff = d => Math.floor((now - new Date(d)) / 86400000);

  const bucket = days => {
    if (days <= 0) return 'current';
    if (days <= 30) return '1-30';
    if (days <= 60) return '31-60';
    if (days <= 90) return '61-90';
    return '90+';
  };

  const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];
  const COLORS = { current: 'var(--green)', '1-30': 'var(--accent)', '31-60': 'var(--amber)', '61-90': 'var(--red)', '90+': 'var(--red)' };

  const activeInvs = bi.filter(i => {
    if (['cancelled', 'proforma', 'draft', 'paid'].includes(i.status)) return false;
    return viewType === 'receivable' ? i.type === 'sale' : i.type === 'purchase';
  });

  const partyRows = useMemo(() => {
    const map = {};
    activeInvs.forEach(inv => {
      const paid = (paysByInv[inv.id] || []).reduce((s, p) => s + Number(p.amount), 0);
      const balance = Math.max(0, Number(inv.total) - paid);
      if (balance <= 0) return;
      const days = inv.due_date ? daysDiff(inv.due_date) : daysDiff(inv.issue_date);
      const b = bucket(days);
      const party = parties.find(p => p.id === inv.party_id);
      const key = inv.party_id;
      if (!map[key]) map[key] = { name: party?.name || '—', total: 0, current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, invoices: [] };
      map[key][b] += balance;
      map[key].total += balance;
      map[key].invoices.push({ ...inv, balance, days });
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [activeInvs, paysByInv, parties]);

  const totals = BUCKETS.reduce((t, b) => ({ ...t, [b]: partyRows.reduce((s, r) => s + r[b], 0) }), {});
  const grandTotal = partyRows.reduce((s, r) => s + r.total, 0);

  function exportCSV() {
    const rows = [['Party', ...BUCKETS, 'Total']];
    partyRows.forEach(r => rows.push([r.name, ...BUCKETS.map(b => r[b].toFixed(2)), r.total.toFixed(2)]));
    rows.push(['TOTAL', ...BUCKETS.map(b => totals[b].toFixed(2)), grandTotal.toFixed(2)]);
    const csv = rows.map(r => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `aging_${viewType}_${today()}.csv`; a.click();
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div className="pill-tabs" style={{ marginBottom: 0 }}>
          <button className={`pill-tab ${viewType === 'receivable' ? 'active' : ''}`} onClick={() => setViewType('receivable')}>Receivable (Clients)</button>
          <button className={`pill-tab ${viewType === 'payable' ? 'active' : ''}`} onClick={() => setViewType('payable')}>Payable (Vendors)</button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={exportCSV}>↓ CSV</button>
      </div>

      {/* Summary buckets */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 16 }}>
        {BUCKETS.map(b => (
          <div key={b} className="card" style={{ padding: '10px 14px', borderTop: `2px solid ${COLORS[b]}` }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', marginBottom: 4 }}>{b === 'current' ? 'Not Due' : b + ' days'}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: COLORS[b] }}>{fmt(totals[b])}</div>
          </div>
        ))}
      </div>

      {partyRows.length === 0
        ? <EmptyState icon="📊" message="No outstanding balances" sub="All invoices are paid or no active invoices" />
        : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Party</th>
                  {BUCKETS.map(b => <th key={b} className="r">{b === 'current' ? 'Not Due' : b + 'd'}</th>)}
                  <th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {partyRows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    {BUCKETS.map(b => (
                      <td key={b} className="r mono" style={{ color: r[b] > 0 ? COLORS[b] : 'var(--text4)', fontSize: 12 }}>
                        {r[b] > 0 ? fmt(r[b]) : '—'}
                      </td>
                    ))}
                    <td className="r mono" style={{ fontWeight: 700 }}>{fmt(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border2)' }}>
                  <td style={{ fontWeight: 700, fontSize: 12 }}>TOTAL</td>
                  {BUCKETS.map(b => <td key={b} className="r mono" style={{ fontWeight: 700, fontSize: 12 }}>{fmt(totals[b])}</td>)}
                  <td className="r mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmt(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
    </div>
  );
}

// ─── PARTY STATEMENT ──────────────────────────────────────────────────────────

export function PartyStatementView({ parties, invoices, payments, creditNotes, businesses, activeBiz }) {
  const [partyId, setPartyId] = useState('');

  const filteredParties = activeBiz ? parties.filter(p => p.business_id === activeBiz) : parties;
  const party = parties.find(p => p.id === partyId);

  const partyInvs = invoices.filter(i => i.party_id === partyId && !['cancelled', 'proforma'].includes(i.status))
    .sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date));
  const partyPayments = payments.filter(p => partyInvs.some(i => i.id === p.invoice_id))
    .sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date));
  const partyCNs = creditNotes.filter(c => c.party_id === partyId)
    .sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date));

  // Build ledger lines
  const lines = [];
  partyInvs.forEach(inv => lines.push({ date: inv.issue_date, type: 'invoice', ref: inv.invoice_number, desc: 'Invoice', debit: Number(inv.total), credit: 0, id: inv.id }));
  partyPayments.forEach(pay => lines.push({ date: pay.payment_date, type: 'payment', ref: pay.reference || pay.mode, desc: `Payment (${pay.mode})`, debit: 0, credit: Number(pay.amount), id: pay.id }));
  partyCNs.forEach(cn => lines.push({ date: cn.issue_date, type: 'cn', ref: cn.cn_number, desc: 'Credit Note', debit: 0, credit: Number(cn.amount), id: cn.id }));
  lines.sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  const linesWithBal = lines.map(l => { running += l.debit - l.credit; return { ...l, balance: running }; });
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const closingBal = totalDebit - totalCredit;

  function printStatement() {
    const biz = businesses.find(b => b.id === (party?.business_id));
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Statement — ${party?.name}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:30px}
    h2{margin:0 0 4px}p{margin:2px 0;color:#555}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    th{background:#f0f0f0;padding:7px 10px;text-align:left;border:1px solid #ddd;font-size:11px}
    td{padding:6px 10px;border:1px solid #ddd;font-size:11px}
    .r{text-align:right}.cr{color:green}.dr{color:#c00}.total{font-weight:700;background:#fafafa}
    </style></head><body>
    <h2>${biz?.name || ''}</h2>
    <p>${biz?.address || ''} | GST: ${biz?.gstin || ''}</p>
    <hr style="margin:12px 0"/>
    <h3 style="margin:0 0 4px">Account Statement — ${party?.name}</h3>
    <p>As of ${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</p>
    <table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="r">Debit (₹)</th><th class="r">Credit (₹)</th><th class="r">Balance (₹)</th></tr></thead>
    <tbody>
    ${linesWithBal.map(l => `<tr>
      <td>${new Date(l.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td>
      <td>${l.ref || '—'}</td><td>${l.desc}</td>
      <td class="r ${l.debit ? 'dr' : ''}">${l.debit ? l.debit.toLocaleString('en-IN',{minimumFractionDigits:2}) : '—'}</td>
      <td class="r ${l.credit ? 'cr' : ''}">${l.credit ? l.credit.toLocaleString('en-IN',{minimumFractionDigits:2}) : '—'}</td>
      <td class="r">${l.balance.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
    </tr>`).join('')}
    <tr class="total"><td colspan="3">CLOSING BALANCE</td>
    <td class="r">${totalDebit.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
    <td class="r">${totalCredit.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
    <td class="r ${closingBal > 0 ? 'dr' : 'cr'}">${Math.abs(closingBal).toLocaleString('en-IN',{minimumFractionDigits:2})} ${closingBal > 0 ? 'Dr' : 'Cr'}</td></tr>
    </tbody></table>
    <p style="margin-top:20px;font-size:10px;color:#999">Generated by Needle Point ERP · ${new Date().toLocaleString('en-IN')}</p>
    </body></html>`);
    w.document.close(); w.print();
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select value={partyId} onChange={e => setPartyId(e.target.value)}
          style={{ flex: 1, maxWidth: 320, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
          <option value="">Select a party…</option>
          {filteredParties.map(p => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
        </select>
        {partyId && <button className="btn btn-ghost btn-sm" onClick={printStatement}>🖨 Print / PDF</button>}
      </div>

      {!partyId && <EmptyState icon="👥" message="Select a party" sub="Choose a client or vendor to view their account statement" />}

      {partyId && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <div className="card" style={{ flex: 1, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>TOTAL INVOICED</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>{fmt(totalDebit)}</div>
            </div>
            <div className="card" style={{ flex: 1, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>TOTAL RECEIVED</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>{fmt(totalCredit)}</div>
            </div>
            <div className="card" style={{ flex: 1, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>CLOSING BALANCE</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: closingBal > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(Math.abs(closingBal))} {closingBal > 0 ? 'Dr' : 'Cr'}</div>
            </div>
          </div>

          {linesWithBal.length === 0
            ? <EmptyState icon="📋" message="No transactions" sub="No invoices or payments found for this party" />
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Date</th><th>Reference</th><th>Description</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th></tr>
                  </thead>
                  <tbody>
                    {linesWithBal.map((l, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: 11 }}>{fmtDate(l.date)}</td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{l.ref || '—'}</td>
                        <td style={{ fontSize: 12 }}>{l.desc}</td>
                        <td className="r mono" style={{ color: l.debit ? 'var(--red)' : 'var(--text4)', fontSize: 12 }}>{l.debit ? fmt(l.debit) : '—'}</td>
                        <td className="r mono" style={{ color: l.credit ? 'var(--green)' : 'var(--text4)', fontSize: 12 }}>{l.credit ? fmt(l.credit) : '—'}</td>
                        <td className="r mono" style={{ fontWeight: 600, fontSize: 12, color: l.balance > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(Math.abs(l.balance))} {l.balance > 0 ? 'Dr' : 'Cr'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border2)' }}>
                      <td colSpan={3} style={{ fontWeight: 700 }}>CLOSING BALANCE</td>
                      <td className="r mono" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmt(totalDebit)}</td>
                      <td className="r mono" style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(totalCredit)}</td>
                      <td className="r mono" style={{ fontWeight: 700, color: closingBal > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(Math.abs(closingBal))} {closingBal > 0 ? 'Dr' : 'Cr'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </>
      )}
    </div>
  );
}

// ─── BULK PAYMENT ─────────────────────────────────────────────────────────────

export function BulkPaymentView({ invoices, parties, payments, businesses, activeBiz, reload }) {
  const [partyId, setPartyId] = useState('');
  const [payDate, setPayDate] = useState(today());
  const [payMode, setPayMode] = useState('UPI');
  const [reference, setReference] = useState('');
  const [selected, setSelected] = useState({});
  const [busy, setSaving] = useState(false);

  const filteredParties = (activeBiz ? parties.filter(p => p.business_id === activeBiz) : parties)
    .filter(p => p.type === 'client');

  const paysByInv = {};
  payments.forEach(p => { if (!paysByInv[p.invoice_id]) paysByInv[p.invoice_id] = []; paysByInv[p.invoice_id].push(p); });

  const pendingInvs = invoices.filter(i =>
    i.party_id === partyId &&
    i.type === 'sale' &&
    !['cancelled', 'proforma', 'paid'].includes(i.status)
  ).map(inv => {
    const paid = (paysByInv[inv.id] || []).reduce((s, p) => s + Number(p.amount), 0);
    const balance = Math.max(0, Number(inv.total) - paid);
    return { ...inv, paid, balance };
  }).filter(i => i.balance > 0);

  function toggleAll() {
    const allSel = pendingInvs.every(i => selected[i.id] !== undefined);
    if (allSel) setSelected({});
    else setSelected(Object.fromEntries(pendingInvs.map(i => [i.id, i.balance])));
  }

  function setAmount(id, val) { setSelected(s => ({ ...s, [id]: val })); }
  function toggle(inv) {
    setSelected(s => {
      const n = { ...s };
      if (n[inv.id] !== undefined) delete n[inv.id];
      else n[inv.id] = inv.balance;
      return n;
    });
  }

  const totalPaying = Object.values(selected).reduce((s, v) => s + Number(v || 0), 0);

  async function save() {
    const entries = Object.entries(selected).filter(([, v]) => Number(v) > 0);
    if (!entries.length) return;
    setSaving(true);
    for (const [invId, amount] of entries) {
      const inv = pendingInvs.find(i => i.id === invId);
      if (!inv) continue;
      await savePayment({ invoice_id: invId, amount: Number(amount), payment_date: payDate, mode: payMode, reference: reference || null });
      const newPaid = inv.paid + Number(amount);
      const newStatus = newPaid >= Number(inv.total) - 0.01 ? 'paid' : 'partially_paid';
      await updateInvoiceStatus(invId, newStatus);
    }
    setSaving(false);
    setSelected({});
    reload();
    alert(`✅ ${entries.length} payment(s) recorded.`);
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">Payment Details</div>
        <div className="form-row cols-4">
          <FG label="Client">
            <select value={partyId} onChange={e => { setPartyId(e.target.value); setSelected({}); }}
              style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
              <option value="">Select client…</option>
              {filteredParties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FG>
          <FG label="Payment Date"><input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></FG>
          <FG label="Mode">
            <select value={payMode} onChange={e => setPayMode(e.target.value)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
              {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </FG>
          <FG label="Reference / UTR"><input value={reference} onChange={e => setReference(e.target.value)} placeholder="UTR / cheque no." /></FG>
        </div>
      </div>

      {!partyId && <EmptyState icon="💳" message="Select a client" sub="Choose a client to see their outstanding invoices" />}

      {partyId && pendingInvs.length === 0 && <EmptyState icon="✅" message="All paid" sub="No outstanding invoices for this client" />}

      {partyId && pendingInvs.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{Object.keys(selected).length} of {pendingInvs.length} selected · Paying {fmt(totalPaying)}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={toggleAll}>Toggle All</button>
              <button className="btn btn-primary" onClick={save} disabled={busy || totalPaying <= 0}>
                {busy ? 'Saving…' : `Record ${Object.keys(selected).length} Payment(s)`}
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ width: 32 }}></th><th>Invoice #</th><th>Date</th><th>Due</th><th className="r">Invoice Total</th><th className="r">Paid</th><th className="r">Balance</th><th className="r">Paying Now</th></tr></thead>
              <tbody>
                {pendingInvs.map(inv => (
                  <tr key={inv.id} style={{ opacity: selected[inv.id] === undefined ? 0.5 : 1 }}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={selected[inv.id] !== undefined} onChange={() => toggle(inv)}
                        style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                    </td>
                    <td className="mono" style={{ color: 'var(--accent)', fontSize: 11 }}>{inv.invoice_number}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{fmtDate(inv.issue_date)}</td>
                    <td className="mono" style={{ fontSize: 11, color: inv.due_date && new Date(inv.due_date) < new Date() ? 'var(--red)' : 'var(--text3)' }}>{fmtDate(inv.due_date)}</td>
                    <td className="r mono" style={{ fontSize: 12 }}>{fmt(inv.total)}</td>
                    <td className="r mono" style={{ fontSize: 12, color: 'var(--green)' }}>{fmt(inv.paid)}</td>
                    <td className="r mono" style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}>{fmt(inv.balance)}</td>
                    <td className="r" style={{ width: 120 }}>
                      {selected[inv.id] !== undefined
                        ? <input type="number" value={selected[inv.id]} onChange={e => setAmount(inv.id, e.target.value)}
                            style={{ width: 100, background: 'var(--bg3)', border: '1px solid var(--accent)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }} />
                        : <span style={{ color: 'var(--text4)', fontFamily: 'var(--mono)', fontSize: 12 }}>—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── RECURRING TEMPLATES ──────────────────────────────────────────────────────

const RECUR_KEY = 'np_recurring_templates';
function loadTemplates() { try { return JSON.parse(localStorage.getItem(RECUR_KEY) || '[]'); } catch { return []; } }
function saveTemplates(ts) { localStorage.setItem(RECUR_KEY, JSON.stringify(ts)); }

export function RecurringView({ invoices, parties, businesses, activeBiz, reload, catalogItems, payments, creditNotes }) {
  const [templates, setTemplates] = useState(loadTemplates);
  const [showModal, setShowModal] = useState(false);
  const [generating, setGenerating] = useState(null);

  function addTemplate(t) {
    const updated = [...templates, { ...t, id: Date.now().toString() }];
    setTemplates(updated); saveTemplates(updated);
  }
  function delTemplate(id) {
    const updated = templates.filter(t => t.id !== id);
    setTemplates(updated); saveTemplates(updated);
  }

  async function generateInvoice(tmpl) {
    setGenerating(tmpl.id);
    try {
      const { supabase } = await import('../lib/db.js');
      // Build invoice data from template
      const fy = getFY();
      const { data: existingInvs } = await supabase.from('invoices').select('invoice_number').eq('business_id', tmpl.business_id);
      const pat = new RegExp(`^${fy}/(\\d+)$`);
      let max = 1000;
      (existingInvs || []).forEach(i => { const m = (i.invoice_number || '').match(pat); if (m) max = Math.max(max, parseInt(m[1], 10)); });
      const invNumber = `${fy}/${max + 1}`;

      const items = tmpl.items || [];
      const subtotal = items.reduce((s, it) => s + Number(it.taxable || 0), 0);
      const tax = items.reduce((s, it) => s + Number(it.cgst || 0) + Number(it.sgst || 0) + Number(it.igst || 0), 0);
      const total = subtotal + tax;

      await saveInvoice({
        business_id: tmpl.business_id,
        party_id: tmpl.party_id,
        invoice_number: invNumber,
        type: 'sale',
        status: 'draft',
        issue_date: today(),
        due_date: tmpl.due_days ? new Date(Date.now() + tmpl.due_days * 86400000).toISOString().split('T')[0] : null,
        notes: tmpl.notes || '',
        subtotal, tax_amount: tax, total,
        cgst_amount: items.reduce((s, it) => s + Number(it.cgst || 0), 0),
        sgst_amount: items.reduce((s, it) => s + Number(it.sgst || 0), 0),
        igst_amount: items.reduce((s, it) => s + Number(it.igst || 0), 0),
        is_interstate: tmpl.is_interstate || false,
        discount_percent: 0, discount_amount: 0,
      }, items);

      // Update last generated
      const updated = templates.map(t => t.id === tmpl.id ? { ...t, last_generated: today() } : t);
      setTemplates(updated); saveTemplates(updated);
      reload();
      alert(`✅ Invoice ${invNumber} created as Draft.`);
    } catch (e) {
      alert('Failed: ' + e.message);
    }
    setGenerating(null);
  }

  const bizTemplates = activeBiz ? templates.filter(t => t.business_id === activeBiz) : templates;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Template</button>
      </div>

      {bizTemplates.length === 0
        ? <EmptyState icon="🔁" message="No recurring templates" sub="Create a template for invoices you send regularly — generate them in one click" />
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
            {bizTemplates.map(t => {
              const party = parties.find(p => p.id === t.party_id);
              const total = (t.items || []).reduce((s, it) => s + Number(it.lineTotal || 0), 0);
              return (
                <div key={t.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{party?.name || '—'}</div>
                    </div>
                    <button className="btn btn-danger btn-sm" onClick={() => delTemplate(t.id)}>Del</button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3 }}>{(t.items || []).length} line item(s)</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>{fmt(total)}</div>
                  {t.last_generated && <div style={{ fontSize: 10, color: 'var(--text4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>Last generated: {fmtDate(t.last_generated)}</div>}
                  <button className="btn btn-primary btn-sm" style={{ width: '100%' }}
                    onClick={() => generateInvoice(t)} disabled={generating === t.id}>
                    {generating === t.id ? 'Generating…' : '⚡ Generate Invoice'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

      {showModal && (
        <TemplateModal
          onClose={() => setShowModal(false)}
          onSave={addTemplate}
          businesses={businesses}
          parties={parties}
          activeBiz={activeBiz}
          catalogItems={catalogItems}
        />
      )}
    </div>
  );
}

function TemplateModal({ onClose, onSave, businesses, parties, activeBiz, catalogItems }) {
  const [name, setName] = useState('');
  const [bizId, setBizId] = useState(activeBiz || businesses[0]?.id || '');
  const [partyId, setPartyId] = useState('');
  const [dueDays, setDueDays] = useState(30);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ description: '', quantity: 1, unit_price: '', tax_percent: 18, taxable: 0, cgst: 0, sgst: 0, igst: 0, lineTotal: 0 }]);
  const [err, setErr] = useState('');

  const clients = parties.filter(p => p.type === 'client' && (bizId ? p.business_id === bizId : true));

  function updItem(idx, field, val) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: val };
      const qty = Number(updated.quantity || 0);
      const price = Number(updated.unit_price || 0);
      const taxable = qty * price;
      const taxPct = Number(updated.tax_percent || 0);
      const { cgst, sgst, igst } = calcLineTax(taxable, taxPct, true);
      return { ...updated, taxable, cgst, sgst, igst, lineTotal: taxable + cgst + sgst + igst };
    }));
  }

  function save() {
    if (!name.trim()) { setErr('Template name required'); return; }
    if (!partyId) { setErr('Select a client'); return; }
    if (!items.some(it => it.description)) { setErr('Add at least one item'); return; }
    onSave({ name, business_id: bizId, party_id: partyId, due_days: Number(dueDays), notes, items });
    onClose();
  }

  return (
    <ModalShell title="New Recurring Template" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save Template</button></>}>
      <div className="form-row cols-2">
        <FG label="Template Name *"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly Fabric Supply — Snug&Co" /></FG>
        <FG label="Business">
          <select value={bizId} onChange={e => setBizId(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Client *">
          <select value={partyId} onChange={e => setPartyId(e.target.value)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 11px' }}>
            <option value="">Select client…</option>
            {clients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FG>
        <FG label="Default Due Days"><input type="number" value={dueDays} onChange={e => setDueDays(e.target.value)} /></FG>
      </div>

      <div className="section-title">Line Items</div>
      {items.map((it, idx) => (
        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 60px 90px 70px 90px 24px', gap: 5, marginBottom: 6, alignItems: 'center' }}>
          <input placeholder="Description" value={it.description} onChange={e => updItem(idx, 'description', e.target.value)}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '6px 8px', fontSize: 12 }} />
          <input type="number" placeholder="Qty" value={it.quantity} onChange={e => updItem(idx, 'quantity', e.target.value)}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '6px 8px', fontSize: 12 }} />
          <input type="number" placeholder="Price" value={it.unit_price} onChange={e => updItem(idx, 'unit_price', e.target.value)}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '6px 8px', fontSize: 12 }} />
          <select value={it.tax_percent} onChange={e => updItem(idx, 'tax_percent', e.target.value)}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '6px 6px', fontSize: 12 }}>
            {GST_RATES.map(r => <option key={r} value={r}>{r}% GST</option>)}
          </select>
          <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{fmt(it.lineTotal)}</div>
          <button className="remove-btn" onClick={() => setItems(items.filter((_, i) => i !== idx))}>×</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => setItems([...items, { description: '', quantity: 1, unit_price: '', tax_percent: 18, taxable: 0, cgst: 0, sgst: 0, igst: 0, lineTotal: 0 }])} style={{ marginBottom: 12 }}>+ Add Item</button>

      <FG label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes for generated invoices" /></FG>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── EXCEL EXPORT ─────────────────────────────────────────────────────────────

export function ExportView({ invoices, expenses, payments, parties, businesses, activeBiz }) {
  const [type, setType] = useState('invoices');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const bi = activeBiz ? invoices.filter(i => i.business_id === activeBiz) : invoices;
  const be = activeBiz ? expenses.filter(e => e.business_id === activeBiz) : expenses;
  const bp = activeBiz ? payments.filter(p => bi.some(i => i.id === p.invoice_id)) : payments;

  function inRange(dateStr) {
    if (!dateStr) return true;
    const d = new Date(dateStr);
    if (fromDate && d < new Date(fromDate)) return false;
    if (toDate && d > new Date(toDate)) return false;
    return true;
  }

  function toCSV(headers, rows) {
    const lines = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))];
    return lines.join('\n');
  }

  function download(csv, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = filename; a.click();
  }

  function exportInvoices() {
    const rows = bi.filter(i => inRange(i.issue_date)).map(inv => {
      const party = parties.find(p => p.id === inv.party_id);
      const pays = payments.filter(p => p.invoice_id === inv.id);
      const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
      return [inv.invoice_number, party?.name || '', party?.gstin || '', inv.issue_date, inv.due_date || '', inv.type, inv.status,
        inv.subtotal, inv.cgst_amount || 0, inv.sgst_amount || 0, inv.igst_amount || 0, inv.tax_amount || 0, inv.total, paid, Number(inv.total) - paid];
    });
    download(toCSV(['Invoice #','Party','GSTIN','Date','Due Date','Type','Status','Taxable','CGST','SGST','IGST','Total Tax','Invoice Total','Paid','Balance'], rows),
      `invoices_${today()}.csv`);
  }

  function exportExpenses() {
    const rows = be.filter(e => inRange(e.expense_date)).map(exp => {
      const vendor = parties.find(p => p.id === exp.vendor_id);
      return [exp.expense_date, exp.category, exp.description || '', vendor?.name || '', exp.method, exp.reference || '', exp.amount];
    });
    download(toCSV(['Date','Category','Description','Vendor','Method','Reference','Amount'], rows), `expenses_${today()}.csv`);
  }

  function exportPayments() {
    const rows = bp.filter(p => inRange(p.payment_date)).map(pay => {
      const inv = bi.find(i => i.id === pay.invoice_id);
      const party = parties.find(p => p.id === inv?.party_id);
      return [pay.payment_date, inv?.invoice_number || '', party?.name || '', pay.mode, pay.reference || '', pay.amount];
    });
    download(toCSV(['Date','Invoice #','Party','Mode','Reference','Amount'], rows), `payments_${today()}.csv`);
  }

  function doExport() {
    if (type === 'invoices') exportInvoices();
    else if (type === 'expenses') exportExpenses();
    else exportPayments();
  }

  const counts = {
    invoices: bi.filter(i => inRange(i.issue_date)).length,
    expenses: be.filter(e => inRange(e.expense_date)).length,
    payments: bp.filter(p => inRange(p.payment_date)).length,
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <div className="card">
        <div className="card-head">Export to CSV / Excel</div>
        <FG label="What to export" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['invoices', 'expenses', 'payments'].map(t => (
              <button key={t} className={`btn btn-sm ${type === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </FG>
        <div className="form-row cols-2">
          <FG label="From Date"><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></FG>
          <FG label="To Date"><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></FG>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14, fontFamily: 'var(--mono)' }}>
          {counts[type]} record(s) will be exported
        </div>
        <button className="btn btn-primary" onClick={doExport} disabled={counts[type] === 0}>
          ↓ Download CSV
        </button>
        <p style={{ fontSize: 11, color: 'var(--text4)', marginTop: 10 }}>
          CSV files open directly in Excel and Google Sheets. Unicode characters (₹) are preserved.
        </p>
      </div>
    </div>
  );
}

// ─── TDS TRACKER ──────────────────────────────────────────────────────────────

export function TDSView({ invoices, payments, parties, businesses, activeBiz }) {
  const [fy] = useState(getFY());
  const bi = activeBiz ? invoices.filter(i => i.business_id === activeBiz) : invoices;

  // Collect invoices that have tds_amount set
  const tdsInvs = bi.filter(i => Number(i.tds_amount) > 0 && i.type === 'sale');

  const partyMap = {};
  tdsInvs.forEach(inv => {
    const party = parties.find(p => p.id === inv.party_id);
    const key = inv.party_id;
    if (!partyMap[key]) partyMap[key] = { name: party?.name || '—', pan: party?.pan || '—', tds: 0, invoices: 0, taxable: 0 };
    partyMap[key].tds += Number(inv.tds_amount || 0);
    partyMap[key].taxable += Number(inv.subtotal || 0);
    partyMap[key].invoices++;
  });
  const rows = Object.values(partyMap).sort((a, b) => b.tds - a.tds);
  const totalTDS = rows.reduce((s, r) => s + r.tds, 0);

  function exportCSV() {
    const lines = [['Party','PAN','Invoices','Taxable Amount','TDS Deducted'].join(','),
      ...rows.map(r => [r.name, r.pan, r.invoices, r.taxable.toFixed(2), r.tds.toFixed(2)].join(','))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `tds_${fy}.csv`; a.click();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>FY {fy} · TDS SUMMARY</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>Total TDS: {fmt(totalTDS)}</div>
        </div>
        {rows.length > 0 && <button className="btn btn-ghost btn-sm" onClick={exportCSV}>↓ CSV</button>}
      </div>

      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text3)', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '9px 13px' }}>
        ℹ TDS amounts are tracked per invoice. To add TDS to an invoice, edit it and set the <strong style={{ color: 'var(--text2)' }}>TDS Amount</strong> field.
      </div>

      {rows.length === 0
        ? <EmptyState icon="📋" message="No TDS recorded" sub="Edit invoices to add TDS deduction amounts" />
        : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Party</th><th>PAN</th><th className="r">Invoices</th><th className="r">Taxable Value</th><th className="r">TDS Deducted</th><th className="r">Effective Rate</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{r.pan}</td>
                    <td className="r mono">{r.invoices}</td>
                    <td className="r mono">{fmt(r.taxable)}</td>
                    <td className="r mono" style={{ color: 'var(--amber)', fontWeight: 600 }}>{fmt(r.tds)}</td>
                    <td className="r mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{r.taxable > 0 ? ((r.tds / r.taxable) * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border2)' }}>
                  <td colSpan={4} style={{ fontWeight: 700 }}>TOTAL</td>
                  <td className="r mono" style={{ fontWeight: 700, color: 'var(--amber)' }}>{fmt(totalTDS)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
    </div>
  );
}
