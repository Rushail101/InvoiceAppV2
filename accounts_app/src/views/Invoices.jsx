import { useState } from 'react';
import { fmt, fmtDate, today, GST_RATES, PAY_MODES, INDIAN_STATES, gstType, calcLineTax, nextInvNum, getFY } from '../lib/constants.js';
import { saveInvoice, getInvoiceItems, updateInvoiceStatus, deleteInvoice, savePayment } from '../lib/db.js';
import { printInvoice } from '../lib/pdf.js';
import { Badge, ModalShell, FG, PayHistory, EmptyState } from '../components/ui.jsx';

// ─── LINE ITEM CALCULATION ─────────────────────────────────────────────────────
function calcItem(it, isIntrastate) {
  const base = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  const discAmt = base * (Number(it.discount_percent || 0) / 100);
  const taxable = base - discAmt;
  const { cgst, sgst, igst } = calcLineTax(taxable, Number(it.tax_percent || 0), isIntrastate);
  const lineTotal = taxable + cgst + sgst + igst;
  return { ...it, base, discAmt, taxable, cgst, sgst, igst, lineTotal };
}

// ─── INVOICE MODAL ─────────────────────────────────────────────────────────────
export function InvoiceModal({ onClose, onSave, businesses, parties, catalogItems = [], editData, allInvoices, isProforma = false }) {
  const isPF = isProforma || (editData?.status === 'proforma');
  const activeBiz = businesses[0];

  const [f, setF] = useState({
    business_id: editData?.business_id || activeBiz?.id || '',
    party_id: editData?.party_id || '',
    invoice_number: editData?.invoice_number || nextInvNum(allInvoices, isPF),
    type: editData?.type || 'sale',
    issue_date: editData?.issue_date || today(),
    due_date: editData?.due_date || '',
    status: editData?.status || (isPF ? 'proforma' : 'draft'),
    notes: editData?.notes || '',
    discount_percent: editData?.discount_percent || 0,
  });

  const [items, setItems] = useState(
    editData?.items?.length ? editData.items
      : [{ description: '', hsn_code: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 5 }]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bizObj = businesses.find(b => b.id === f.business_id) || {};
  const partyObj = parties.find(p => p.id === f.party_id) || {};
  const isIntrastate = gstType(bizObj.state, partyObj.state) === 'intrastate';
  const filteredParties = parties.filter(p => p.business_id === f.business_id);

  const calc = items.map(it => calcItem(it, isIntrastate));
  const subtotal = calc.reduce((s, i) => s + i.taxable, 0);
  const totalCGST = calc.reduce((s, i) => s + i.cgst, 0);
  const totalSGST = calc.reduce((s, i) => s + i.sgst, 0);
  const totalIGST = calc.reduce((s, i) => s + i.igst, 0);
  const totalTax = totalCGST + totalSGST + totalIGST;
  const grand = subtotal + totalTax;

  // Invoice-level discount on top of line discounts
  const invDiscAmt = grand * (Number(f.discount_percent || 0) / 100);
  const finalTotal = grand - invDiscAmt;

  function upd(idx, field, val) { setItems(prev => prev.map((it, i) => i !== idx ? it : { ...it, [field]: val })); }
  function addRow() { setItems(p => [...p, { description: '', hsn_code: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 5 }]); }
  function remRow(idx) { setItems(p => p.filter((_, i) => i !== idx)); }

  async function save() {
    if (!f.party_id) { setErr('Select a party'); return; }
    const validItems = calc.filter(i => i.description?.trim());
    if (!validItems.length) { setErr('Add at least one line item'); return; }
    setErr(''); setBusy(true);
    try {
      const invData = {
        ...f,
        subtotal,
        cgst_amount: totalCGST,
        sgst_amount: totalSGST,
        igst_amount: totalIGST,
        tax_amount: totalTax,
        discount_amount: invDiscAmt,
        total: finalTotal,
        is_interstate: !isIntrastate,
      };
      await onSave(invData, validItems, editData?.id);
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const gstLabel = isIntrastate
    ? <span>GST split: <span className="gst-chip cgst">CGST</span> <span className="gst-chip sgst">SGST</span></span>
    : <span>GST type: <span className="gst-chip igst">IGST</span> (inter-state)</span>;

  return (
    <ModalShell title={editData ? 'Edit Invoice' : (isPF ? 'New Proforma Invoice' : 'New Tax Invoice')} onClose={onClose} size="modal-xl"
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Invoice'}</button></>}>

      {isPF && <div className="pf-banner">⚡ Proforma Invoice — numbered PI-… Use "→ Invoice" to convert when approved.</div>}

      {/* Top fields */}
      <div className="form-row cols-3">
        <FG label="Business">
          <select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value, party_id: '' }))}>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FG>
        <FG label="Invoice Type">
          <select value={f.type} onChange={e => setF(x => ({ ...x, type: e.target.value }))}>
            <option value="sale">Sale (Invoice)</option>
            <option value="purchase">Purchase (Bill)</option>
          </select>
        </FG>
        <FG label="Invoice #">
          <input value={f.invoice_number} onChange={e => setF(x => ({ ...x, invoice_number: e.target.value }))} />
        </FG>
      </div>

      <div className="form-row cols-3">
        <FG label="Party *">
          <select value={f.party_id} onChange={e => setF(x => ({ ...x, party_id: e.target.value }))}>
            <option value="">Select party…</option>
            {filteredParties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FG>
        <FG label="Issue Date"><input type="date" value={f.issue_date} onChange={e => setF(x => ({ ...x, issue_date: e.target.value }))} /></FG>
        <FG label="Due Date"><input type="date" value={f.due_date} onChange={e => setF(x => ({ ...x, due_date: e.target.value }))} /></FG>
      </div>

      <div className="form-row cols-3">
        <FG label="Status">
          <select value={f.status} onChange={e => setF(x => ({ ...x, status: e.target.value }))}>
            {['proforma', 'draft', 'sent', 'paid', 'overdue', 'cancelled'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </FG>
        <FG label="Invoice Discount %"><input type="number" min="0" max="100" value={f.discount_percent} onChange={e => setF(x => ({ ...x, discount_percent: e.target.value }))} /></FG>
        <FG label="Notes / Terms"><input value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} placeholder="Due on Receipt" /></FG>
      </div>

      {/* GST type indicator */}
      {f.party_id && (
        <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text2)' }}>
          {gstLabel}
          {bizObj.state && partyObj.state && <span style={{ marginLeft: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 11 }}>({bizObj.state} → {partyObj.state})</span>}
        </div>
      )}

      {/* Line items */}
      <div className="section-title">Line Items</div>
      <div className="line-items-head" style={{ gridTemplateColumns: '2fr 90px 70px 100px 72px 60px 100px 28px' }}>
        <span>Description</span><span>HSN</span><span>Qty</span><span>Rate</span><span>Disc%</span><span>GST%</span><span style={{ textAlign: 'right' }}>Amount</span><span></span>
      </div>

      {items.map((it, idx) => {
        const c = calcItem(it, isIntrastate);
        return (
          <div className="line-item-row" key={idx} style={{ gridTemplateColumns: '2fr 90px 70px 100px 72px 60px 100px 28px' }}>
            <div style={{ position: 'relative', display: 'flex', gap: 3 }}>
              <input placeholder="Product / service" value={it.description} onChange={e => upd(idx, 'description', e.target.value)} style={{ flex: 1 }} />
              {catalogItems.filter(i => bizObj && i.business_id === f.business_id).length > 0 && (
                <select
                  style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--accent)', borderRadius: 'var(--r)', padding: '4px 6px', fontSize: 10, fontFamily: 'var(--mono)', cursor: 'pointer', flexShrink: 0, maxWidth: 120 }}
                  value=""
                  onChange={e => {
                    if (!e.target.value) return;
                    const item = catalogItems.find(i => i.id === e.target.value);
                    if (item) setItems(prev => prev.map((it2, i2) => i2 !== idx ? it2 : {
                      ...it2,
                      description: item.name,
                      hsn_code: item.hsn_code || it2.hsn_code,
                      unit_price: item.sale_price || it2.unit_price,
                      tax_percent: item.tax_percent ?? it2.tax_percent,
                    }));
                  }}
                >
                  <option value="">📦 Pick…</option>
                  {catalogItems.filter(i => i.business_id === f.business_id).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              )}
            </div>
            <input placeholder="HSN" value={it.hsn_code || ''} onChange={e => upd(idx, 'hsn_code', e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
            <input type="number" min="0" value={it.quantity} onChange={e => upd(idx, 'quantity', e.target.value)} />
            <input type="number" min="0" value={it.unit_price} onChange={e => upd(idx, 'unit_price', e.target.value)} />
            <input type="number" min="0" max="100" value={it.discount_percent || 0} onChange={e => upd(idx, 'discount_percent', e.target.value)} />
            <select value={it.tax_percent} onChange={e => upd(idx, 'tax_percent', e.target.value)}>
              {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
            </select>
            <div className="line-total">{fmt(c.lineTotal)}</div>
            <button className="remove-btn" onClick={() => remRow(idx)}>×</button>
          </div>
        );
      })}

      <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={addRow}>+ Add line</button>

      {/* Totals */}
      <div className="inv-totals">
        <p><span>Subtotal (Taxable)</span><span>{fmt(subtotal)}</span></p>
        {isIntrastate ? (
          <>
            <p><span>CGST</span><span>{fmt(totalCGST)}</span></p>
            <p><span>SGST</span><span>{fmt(totalSGST)}</span></p>
          </>
        ) : (
          <p><span>IGST</span><span>{fmt(totalIGST)}</span></p>
        )}
        {invDiscAmt > 0 && <p><span>Invoice Discount ({f.discount_percent}%)</span><span>-{fmt(invDiscAmt)}</span></p>}
        <p className="grand"><span>Total</span><span>{fmt(finalTotal)}</span></p>
      </div>

      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── PAYMENT MODAL ─────────────────────────────────────────────────────────────
export function PaymentModal({ onClose, onSave, invoice, existingPayments }) {
  const totalPaid = existingPayments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Number(invoice.total) - totalPaid;
  const [f, setF] = useState({ amount: balance.toFixed(2), payment_date: today(), method: 'UPI', reference: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const amt = Number(f.amount);
    if (!amt || amt <= 0) { setErr('Enter a valid amount'); return; }
    if (amt > balance + 0.01) { setErr(`Max allowed: ${fmt(balance)}`); return; }
    setBusy(true);
    try {
      await onSave({ ...f, amount: amt, invoice_id: invoice.id, business_id: invoice.business_id, party_id: invoice.party_id });
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title={invoice.status === 'proforma' ? 'Record Advance Payment' : 'Record Payment'} onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : invoice.status === 'proforma' ? 'Record Advance' : 'Record Payment'}</button></>}>
      {invoice.status === 'proforma' && (
        <div style={{ background: '#1a1030', border: '1px solid #2a1e50', borderRadius: 8, padding: '9px 13px', marginBottom: 12, fontSize: 12, color: 'var(--purple)', lineHeight: 1.5 }}>
          ⚡ <strong>Proforma Invoice</strong> — recording advance payment.<br />
          Tax invoice number <strong>({getFY()}/XXXX)</strong> will be assigned automatically once the full amount of <strong>{fmt(invoice.total)}</strong> is received.
        </div>
      )}
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
        {invoice.invoice_number} — Total {fmt(invoice.total)}
        {totalPaid > 0 && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>· {fmt(totalPaid)} received · {fmt(balance)} remaining</span>}
      </p>
      <PayHistory payments={existingPayments} invoiceTotal={Number(invoice.total)} />
      <div style={{ marginTop: 14 }} className="form-row cols-2">
        <FG label="Amount (₹) *"><input type="number" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} /></FG>
        <FG label="Date *"><input type="date" value={f.payment_date} onChange={e => setF(x => ({ ...x, payment_date: e.target.value }))} /></FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Method"><select value={f.method} onChange={e => setF(x => ({ ...x, method: e.target.value }))}>{PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}</select></FG>
        <FG label="Reference / UTR"><input value={f.reference} onChange={e => setF(x => ({ ...x, reference: e.target.value }))} placeholder="UTR / cheque no." /></FG>
      </div>
      <FG label="Notes"><textarea value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} /></FG>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── INVOICES VIEW ─────────────────────────────────────────────────────────────
export function InvoicesView({ invoices, businesses, parties, activeBiz, reload, payments, creditNotes, catalogItems = [] }) {
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('');
  const [showInv, setShowInv] = useState(false);
  const [showPF, setShowPF] = useState(false);
  const [editData, setEditData] = useState(null);
  const [payInv, setPayInv] = useState(null);

  const paysByInv = {};
  payments.forEach(p => { if (!paysByInv[p.invoice_id]) paysByInv[p.invoice_id] = []; paysByInv[p.invoice_id].push(p); });

  const cnsByInv = {};
  creditNotes.forEach(cn => { if (!cnsByInv[cn.invoice_id]) cnsByInv[cn.invoice_id] = []; cnsByInv[cn.invoice_id].push(cn); });

  const filtered = invoices.filter(i => {
    const biz = activeBiz ? i.business_id === activeBiz : true;
    const stMatch = sf ? i.status === sf : true;
    const s = search.toLowerCase();
    const nameMatch = !s || i.invoice_number.toLowerCase().includes(s) || (parties.find(p => p.id === i.party_id)?.name || '').toLowerCase().includes(s);
    return biz && stMatch && nameMatch;
  });

  async function handleSave(invData, items, id) {
    await saveInvoice(invData, items, id);
    reload();
  }

  async function handlePayment(data) {
    const amt = Number(data.amount);
    await savePayment(data);
    const inv = invoices.find(i => i.id === data.invoice_id);
    const prev = (paysByInv[data.invoice_id] || []).reduce((s, p) => s + Number(p.amount), 0);
    const totalPaid = prev + amt;
    const isFullyPaid = totalPaid >= Number(inv?.total) - 0.01;

    if (inv?.status === 'proforma') {
      if (isFullyPaid) {
        // Auto-convert: assign next invoice number and mark paid
        const newNum = nextInvNum(invoices, false);
        const { supabase } = await import('../lib/db.js');
        await supabase.from('invoices')
          .update({ status: 'paid', invoice_number: newNum })
          .eq('id', data.invoice_id);
        alert(`✅ Full payment received!\nInvoice number ${newNum} has been assigned automatically.`);
      }
      // Partial advance on proforma — just record payment, keep status as proforma
    } else {
      const newStatus = isFullyPaid ? 'paid' : 'partially_paid';
      await updateInvoiceStatus(data.invoice_id, newStatus);
    }
    reload();
  }

  async function convertProforma(inv) {
    if (!confirm(`Manually convert ${inv.invoice_number} to Tax Invoice?\n\nNormally the invoice number is assigned automatically when full payment is received.\nOnly proceed if you want to assign a number now without full payment.`)) return;
    const newNum = nextInvNum(invoices, false);
    const { supabase } = await import('../lib/db.js');
    await supabase.from('invoices').update({ status: 'sent', invoice_number: newNum }).eq('id', inv.id);
    reload();
  }

  async function del(id) {
    if (!confirm('Delete this invoice? This cannot be undone.')) return;
    await deleteInvoice(id);
    reload();
  }

  async function dlPDF(inv) {
    const { supabase } = await import('../lib/db.js');
    const { data: items } = await supabase.from('invoice_items').select('*').eq('invoice_id', inv.id);
    const party = parties.find(p => p.id === inv.party_id) || {};
    const biz = businesses.find(b => b.id === inv.business_id) || {};
    printInvoice(inv, items || [], party, biz, paysByInv[inv.id] || []);
  }

  return (
    <>
      <div className="filter-bar">
        <input placeholder="Search invoice #, party name…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={sf} onChange={e => setSf(e.target.value)}>
          <option value="">All Status</option>
          {['proforma', 'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => { setEditData(null); setShowPF(true); }}>+ Proforma</button>
        <button className="btn btn-primary" onClick={() => { setEditData(null); setShowInv(true); }}>+ Invoice</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Invoice #</th><th>Party</th><th>Date</th><th>Due</th>
            <th className="r">Total</th><th className="r">Paid</th><th className="r">Balance</th>
            <th>GST</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map(inv => {
              const ip = paysByInv[inv.id] || [];
              const paid = ip.reduce((s, p) => s + Number(p.amount), 0);
              const bal = Number(inv.total) - paid;
              const gstMode = inv.is_interstate === false ? 'intra' : 'inter';
              return (
                <tr key={inv.id}>
                  <td className="mono">{inv.invoice_number}</td>
                  <td style={{ fontWeight: 500 }}>{parties.find(p => p.id === inv.party_id)?.name || '—'}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtDate(inv.issue_date)}</td>
                  <td className="mono" style={{ fontSize: 11, color: inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'paid' ? 'var(--red)' : 'var(--text3)' }}>{fmtDate(inv.due_date)}</td>
                  <td className="r mono">{fmt(inv.total)}</td>
                  <td className="r mono" style={{ color: 'var(--green)', fontSize: 11 }}>{paid > 0 ? fmt(paid) : '—'}</td>
                  <td className="r mono" style={{ color: bal > 0.01 ? 'var(--amber)' : 'var(--text3)', fontSize: 11 }}>{bal > 0.01 ? fmt(bal) : '✓'}</td>
                  <td><span className={`gst-chip ${gstMode === 'intra' ? 'cgst' : 'igst'}`} style={{ fontSize: 9 }}>{gstMode === 'intra' ? 'C+S' : 'IGST'}</span></td>
                  <td><Badge status={inv.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {inv.status === 'proforma' && <button className="btn btn-warning btn-sm" title="Manually assign invoice number now" onClick={() => convertProforma(inv)}>→ Invoice</button>}
                      {!['paid', 'cancelled'].includes(inv.status) && <button className="btn btn-ghost btn-sm" onClick={() => setPayInv(inv)}>💰</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => dlPDF(inv)}>⬇ PDF</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditData({ ...inv }); setShowInv(true); }}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => del(inv.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={10}><EmptyState icon="📄" message="No invoices found" /></td></tr>}
          </tbody>
        </table>
      </div>

      {showInv && <InvoiceModal onClose={() => setShowInv(false)} onSave={handleSave} businesses={businesses} parties={parties} editData={editData} allInvoices={invoices} catalogItems={catalogItems} />}
      {showPF && <InvoiceModal onClose={() => setShowPF(false)} onSave={handleSave} businesses={businesses} parties={parties} editData={null} allInvoices={invoices} isProforma={true} catalogItems={catalogItems} />}
      {payInv && <PaymentModal onClose={() => setPayInv(null)} onSave={handlePayment} invoice={payInv} existingPayments={paysByInv[payInv.id] || []} />}
    </>
  );
}
