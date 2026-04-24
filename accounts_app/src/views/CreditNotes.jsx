import { useState } from 'react';
import { fmt, fmtDate, today, GST_RATES, gstType, calcLineTax, nextCNNum } from '../lib/constants.js';
import { saveCreditNote } from '../lib/db.js';
import { printInvoice } from '../lib/pdf.js';
import { Badge, ModalShell, FG, EmptyState } from '../components/ui.jsx';

function calcCNItem(it, isIntrastate) {
  const taxable = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  const { cgst, sgst, igst } = calcLineTax(taxable, Number(it.tax_percent || 0), isIntrastate);
  return { ...it, taxable, cgst, sgst, igst, lineTotal: taxable + cgst + sgst + igst };
}

export function CreditNoteModal({ onClose, onSave, businesses, parties, invoices, creditNotes, preInvoice }) {
  const [f, setF] = useState({
    business_id: preInvoice?.business_id || businesses[0]?.id || '',
    party_id: preInvoice?.party_id || '',
    invoice_id: preInvoice?.id || '',
    cn_number: nextCNNum(creditNotes),
    cn_date: today(),
    reason: '',
    notes: '',
  });
  const [items, setItems] = useState([{ description: '', hsn_code: '', quantity: 1, unit_price: 0, tax_percent: 5 }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bizObj = businesses.find(b => b.id === f.business_id) || {};
  const partyObj = parties.find(p => p.id === f.party_id) || {};
  const isIntrastate = gstType(bizObj.state, partyObj.state) === 'intrastate';
  const filteredParties = parties.filter(p => p.business_id === f.business_id);
  const filteredInvoices = invoices.filter(i => i.party_id === f.party_id && !['proforma', 'cancelled'].includes(i.status));

  const calc = items.map(it => calcCNItem(it, isIntrastate));
  const subtotal = calc.reduce((s, i) => s + i.taxable, 0);
  const totalCGST = calc.reduce((s, i) => s + i.cgst, 0);
  const totalSGST = calc.reduce((s, i) => s + i.sgst, 0);
  const totalIGST = calc.reduce((s, i) => s + i.igst, 0);
  const grand = subtotal + totalCGST + totalSGST + totalIGST;

  function upd(idx, field, val) { setItems(prev => prev.map((it, i) => i !== idx ? it : { ...it, [field]: val })); }

  async function save() {
    if (!f.party_id) { setErr('Select a party'); return; }
    const validItems = calc.filter(i => i.description?.trim());
    if (!validItems.length) { setErr('Add at least one item'); return; }
    setErr(''); setBusy(true);
    try {
      const cnData = {
        ...f,
        subtotal,
        cgst_amount: totalCGST,
        sgst_amount: totalSGST,
        igst_amount: totalIGST,
        total: grand,
        is_interstate: !isIntrastate,
        status: 'issued',
      };
      const itemRows = validItems.map(it => ({
        description: it.description,
        hsn_code: it.hsn_code || null,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        tax_percent: Number(it.tax_percent),
        cgst_amount: it.cgst,
        sgst_amount: it.sgst,
        igst_amount: it.igst,
        amount: it.lineTotal,
      }));
      await onSave(cnData, itemRows);
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title="New Credit Note" onClose={onClose} size="modal-xl"
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Issue Credit Note'}</button></>}>

      <div className="cn-banner">🔄 A Credit Note reduces the amount due on an invoice — used for returns, price corrections, or goodwill adjustments.</div>

      <div className="form-row cols-3">
        <FG label="Business"><select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value, party_id: '', invoice_id: '' }))}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></FG>
        <FG label="CN Number"><input value={f.cn_number} onChange={e => setF(x => ({ ...x, cn_number: e.target.value }))} /></FG>
        <FG label="Date"><input type="date" value={f.cn_date} onChange={e => setF(x => ({ ...x, cn_date: e.target.value }))} /></FG>
      </div>

      <div className="form-row cols-3">
        <FG label="Party *"><select value={f.party_id} onChange={e => setF(x => ({ ...x, party_id: e.target.value, invoice_id: '' }))}><option value="">Select…</option>{filteredParties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FG>
        <FG label="Against Invoice (optional)"><select value={f.invoice_id} onChange={e => setF(x => ({ ...x, invoice_id: e.target.value }))}><option value="">None</option>{filteredInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} — {fmt(i.total)}</option>)}</select></FG>
        <FG label="Reason"><select value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))}><option value="">Select…</option>{['Goods returned', 'Price correction', 'Defective goods', 'Duplicate invoice', 'Discount post-sale', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}</select></FG>
      </div>

      <div className="section-title">Items Being Credited</div>
      <div className="line-items-head" style={{ gridTemplateColumns: '2fr 90px 70px 100px 60px 110px 28px' }}>
        <span>Description</span><span>HSN</span><span>Qty</span><span>Rate</span><span>GST%</span><span style={{ textAlign: 'right' }}>Amount</span><span></span>
      </div>
      {items.map((it, idx) => {
        const c = calcCNItem(it, isIntrastate);
        return (
          <div className="line-item-row" key={idx} style={{ gridTemplateColumns: '2fr 90px 70px 100px 60px 110px 28px' }}>
            <input placeholder="Item description" value={it.description} onChange={e => upd(idx, 'description', e.target.value)} />
            <input placeholder="HSN" value={it.hsn_code || ''} onChange={e => upd(idx, 'hsn_code', e.target.value)} />
            <input type="number" min="0" value={it.quantity} onChange={e => upd(idx, 'quantity', e.target.value)} />
            <input type="number" min="0" value={it.unit_price} onChange={e => upd(idx, 'unit_price', e.target.value)} />
            <select value={it.tax_percent} onChange={e => upd(idx, 'tax_percent', e.target.value)}>{GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select>
            <div className="line-total">{fmt(c.lineTotal)}</div>
            <button className="remove-btn" onClick={() => setItems(p => p.filter((_, i) => i !== idx))}>×</button>
          </div>
        );
      })}
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => setItems(p => [...p, { description: '', hsn_code: '', quantity: 1, unit_price: 0, tax_percent: 5 }])}>+ Add line</button>

      <div className="inv-totals">
        <p><span>Subtotal</span><span>{fmt(subtotal)}</span></p>
        {isIntrastate ? <><p><span>CGST</span><span>{fmt(totalCGST)}</span></p><p><span>SGST</span><span>{fmt(totalSGST)}</span></p></> : <p><span>IGST</span><span>{fmt(totalIGST)}</span></p>}
        <p className="grand"><span>Credit Total</span><span>{fmt(grand)}</span></p>
      </div>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

export function CreditNotesView({ creditNotes, invoices, businesses, parties, activeBiz, reload }) {
  const [showModal, setShowModal] = useState(false);
  const filtered = activeBiz ? creditNotes.filter(cn => cn.business_id === activeBiz) : creditNotes;

  async function handleSave(cnData, items) {
    await saveCreditNote(cnData, items);
    reload();
  }

  async function dlPDF(cn) {
    const { supabase } = await import('../lib/db.js');
    const { data: items } = await supabase.from('credit_note_items').select('*').eq('credit_note_id', cn.id);
    const party = parties.find(p => p.id === cn.party_id) || {};
    const biz = businesses.find(b => b.id === cn.business_id) || {};
    const invDoc = { ...cn, invoice_number: cn.cn_number, issue_date: cn.cn_date, status: 'credit_note' };
    printInvoice(invDoc, items || [], party, biz, [], true);
  }

  return (
    <>
      <div className="filter-bar">
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Credit Note</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>CN Number</th><th>Date</th><th>Party</th><th>Against Invoice</th><th>Reason</th><th className="r">Amount</th><th>GST</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(cn => {
              const linkedInv = invoices.find(i => i.id === cn.invoice_id);
              const gstMode = cn.is_interstate === false ? 'intra' : 'inter';
              return (
                <tr key={cn.id}>
                  <td className="mono" style={{ color: '#ff8cc8' }}>{cn.cn_number}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtDate(cn.cn_date)}</td>
                  <td>{parties.find(p => p.id === cn.party_id)?.name || '—'}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{linkedInv?.invoice_number || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text2)' }}>{cn.reason || '—'}</td>
                  <td className="r mono" style={{ color: '#ff8cc8' }}>{fmt(cn.total)}</td>
                  <td><span className={`gst-chip ${gstMode === 'intra' ? 'cgst' : 'igst'}`} style={{ fontSize: 9 }}>{gstMode === 'intra' ? 'C+S' : 'IGST'}</span></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => dlPDF(cn)}>⬇ PDF</button></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8}><EmptyState icon="🔄" message="No credit notes yet" sub="Create one to handle returns or price corrections" /></td></tr>}
          </tbody>
        </table>
      </div>
      {showModal && <CreditNoteModal onClose={() => setShowModal(false)} onSave={handleSave} businesses={businesses} parties={parties} invoices={invoices} creditNotes={creditNotes} />}
    </>
  );
}
