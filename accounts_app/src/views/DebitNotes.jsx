import { useEffect, useRef, useState } from 'react';
import {
  fmt, fmtDate, today, GST_RATES, gstType, calcLineTax, nextDNNum,
  guessHSN, isHSNValid, MIN_HSN_DIGITS,
} from '../lib/constants.js';
import { getInvoiceItems, saveDebitNote, getDebitNoteItems } from '../lib/db.js';
import { printInvoice } from '../lib/pdf.js';
import { ModalShell, FG, EmptyState } from '../components/ui.jsx';

function calcDNItem(it, isIntrastate) {
  const taxable = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  const { cgst, sgst, igst } = calcLineTax(taxable, Number(it.tax_percent || 0), isIntrastate);
  return { ...it, taxable, cgst, sgst, igst, tax: cgst + sgst + igst, lineTotal: taxable + cgst + sgst + igst };
}

export function DebitNoteModal({ onClose, onSave, businesses, parties, invoices, debitNotes, activeBiz }) {
  const initialBizId = activeBiz || businesses[0]?.id || '';
  const [f, setF] = useState({
    business_id: initialBizId,
    party_id: '',
    invoice_id: '',
    dn_number: nextDNNum((debitNotes || []).filter(d => d.business_id === initialBizId)),
    dn_date: today(),
    reason: '',
    notes: '',
  });
  const [items, setItems] = useState([{ description: '', hsn_code: '', quantity: 1, unit_price: 0, tax_percent: 5 }]);
  const [busy, setBusy] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [err, setErr] = useState('');
  const prevBizRef = useRef(initialBizId);

  useEffect(() => {
    if (f.business_id === prevBizRef.current) return;
    prevBizRef.current = f.business_id;
    setF(x => ({ ...x, dn_number: nextDNNum((debitNotes || []).filter(d => d.business_id === f.business_id)), party_id: '', invoice_id: '' }));
    setItems([{ description: '', hsn_code: '', quantity: 1, unit_price: 0, tax_percent: 5 }]);
  }, [f.business_id, debitNotes]);

  const bizObj = businesses.find(b => b.id === f.business_id) || {};
  const partyObj = parties.find(p => p.id === f.party_id) || {};
  const isIntrastate = gstType(bizObj.state, partyObj.state) === 'intrastate';
  const filteredParties = parties.filter(p => p.business_id === f.business_id && (p.type === 'client' || !p.type));
  const filteredInvoices = invoices.filter(i =>
    i.business_id === f.business_id &&
    i.party_id === f.party_id &&
    i.type === 'sale' &&
    !['draft', 'cancelled', 'proforma'].includes(i.status)
  );

  async function selectInvoice(invoiceId) {
    setF(x => ({ ...x, invoice_id: invoiceId }));
    if (!invoiceId) {
      setItems([{ description: '', hsn_code: '', quantity: 1, unit_price: 0, tax_percent: 5 }]);
      return;
    }
    setLoadingItems(true); setErr('');
    try {
      const original = await getInvoiceItems(invoiceId);
      setItems(original.length
        ? original.map(it => ({
            description: it.description || '',
            hsn_code: it.hsn_code || '',
            quantity: Number(it.quantity || 0),
            unit_price: Number(it.unit_price || 0),
            tax_percent: Number(it.tax_percent || 0),
          }))
        : [{ description: '', hsn_code: '', quantity: 1, unit_price: 0, tax_percent: 5 }]
      );
    } catch (e) {
      setErr(`Could not load original invoice items: ${e.message}`);
    }
    setLoadingItems(false);
  }

  const calc = items.map(it => calcDNItem(it, isIntrastate));
  const subtotal = calc.reduce((s, i) => s + i.taxable, 0);
  const totalCGST = calc.reduce((s, i) => s + i.cgst, 0);
  const totalSGST = calc.reduce((s, i) => s + i.sgst, 0);
  const totalIGST = calc.reduce((s, i) => s + i.igst, 0);
  const totalTax = totalCGST + totalSGST + totalIGST;
  const grand = subtotal + totalTax;

  function upd(idx, field, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  }
  function guessHSNOnBlur(idx) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      if (it.hsn_code && !it.hsn_auto) return it;
      const guess = guessHSN(it.description);
      if (!guess) return it.hsn_auto ? { ...it, hsn_code: '', hsn_auto: false, hsn_guess_label: null } : it;
      return { ...it, hsn_code: guess.hsn, hsn_auto: true, hsn_guess_label: guess.label };
    }));
  }
  function editHSN(idx, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, hsn_code: val, hsn_auto: false, hsn_guess_label: null } : it));
  }

  async function save() {
    if (!f.party_id) { setErr('Select a party'); return; }
    if (!f.invoice_id) { setErr('A GST debit note must reference the original invoice (Rule 53).'); return; }
    const validItems = calc.filter(i => i.description?.trim());
    if (!validItems.length) { setErr('Add at least one item'); return; }
    const badHSN = validItems.filter(i => !isHSNValid(i.hsn_code));
    if (badHSN.length) {
      setErr(`HSN code required (min ${MIN_HSN_DIGITS} digits) for: ${badHSN.map(i => i.description).join(', ')}`);
      return;
    }
    if (grand <= 0) { setErr('Debit note total must be greater than zero'); return; }

    setErr(''); setBusy(true);
    try {
      await onSave({
        ...f,
        subtotal,
        cgst_amount: totalCGST,
        sgst_amount: totalSGST,
        igst_amount: totalIGST,
        tax_amount: totalTax,
        total: grand,
        is_interstate: !isIntrastate,
        status: 'issued',
      }, validItems.map(it => ({
        description: it.description,
        hsn_code: it.hsn_code || null,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        tax_percent: Number(it.tax_percent),
        taxable: it.taxable,
        cgst: it.cgst,
        sgst: it.sgst,
        igst: it.igst,
        tax: it.tax,
        lineTotal: it.lineTotal,
      })));
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title="New Debit Note" onClose={onClose} size="modal-xl"
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy || loadingItems}>{busy ? 'Saving…' : 'Issue Debit Note'}</button></>}>
      <div className="cn-banner" style={{ borderColor: 'var(--accent)', background: 'rgba(200,240,100,.04)' }}>
        ↗ A Debit Note increases the taxable value/tax payable against an original supply — for underbilling, value corrections, or additional consideration.
      </div>

      <div className="form-row cols-3">
        <FG label="Business"><select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value }))}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></FG>
        <FG label="DN Number"><input value={f.dn_number} onChange={e => setF(x => ({ ...x, dn_number: e.target.value }))} /></FG>
        <FG label="Date"><input type="date" value={f.dn_date} onChange={e => setF(x => ({ ...x, dn_date: e.target.value }))} /></FG>
      </div>

      <div className="form-row cols-3">
        <FG label="Party *"><select value={f.party_id} onChange={e => { setF(x => ({ ...x, party_id: e.target.value, invoice_id: '' })); setItems([{ description: '', hsn_code: '', quantity: 1, unit_price: 0, tax_percent: 5 }]); }}><option value="">Select…</option>{filteredParties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FG>
        <FG label="Against Invoice *"><select value={f.invoice_id} onChange={e => selectInvoice(e.target.value)} disabled={!f.party_id}><option value="">Select…</option>{filteredInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} — {fmt(i.total)}</option>)}</select></FG>
        <FG label="Reason"><select value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))}><option value="">Select…</option>{['Underbilling / additional value', 'Price correction', 'Additional quantity', 'Additional consideration', 'Tax short charged', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}</select></FG>
      </div>
      <FG label="Notes"><textarea value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} placeholder="Optional explanation or reference" /></FG>

      <div className="section-title">Additional Value / Tax Being Debited</div>
      {loadingItems && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>Loading original invoice items…</div>}
      <div className="line-items-head" style={{ gridTemplateColumns: '2fr 90px 70px 100px 60px 110px 28px' }}>
        <span>Description</span><span>HSN</span><span>Qty</span><span>Rate</span><span>GST%</span><span style={{ textAlign: 'right' }}>Amount</span><span></span>
      </div>
      {items.map((it, idx) => {
        const c = calc[idx];
        return <div className="line-item-row" key={idx} style={{ gridTemplateColumns: '2fr 90px 70px 100px 60px 110px 28px' }}>
          <input placeholder="Item description" value={it.description} onChange={e => upd(idx, 'description', e.target.value)} onBlur={() => guessHSNOnBlur(idx)} />
          <div>
            <input placeholder="HSN" value={it.hsn_code || ''} onChange={e => editHSN(idx, e.target.value)} style={{ borderColor: it.hsn_auto ? 'var(--accent)' : undefined }} title={it.hsn_auto ? `Auto-filled from "${it.hsn_guess_label}"` : ''} />
            {it.hsn_auto && <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 2 }}>auto: {it.hsn_guess_label}</div>}
          </div>
          <input type="number" min="0" value={it.quantity} onChange={e => upd(idx, 'quantity', e.target.value)} />
          <input type="number" min="0" value={it.unit_price} onChange={e => upd(idx, 'unit_price', e.target.value)} />
          <select value={it.tax_percent} onChange={e => upd(idx, 'tax_percent', e.target.value)}>{GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select>
          <div className="line-total">{fmt(c.lineTotal)}</div>
          <button className="remove-btn" onClick={() => setItems(p => p.filter((_, i) => i !== idx))}>×</button>
        </div>;
      })}
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => setItems(p => [...p, { description: '', hsn_code: '', quantity: 1, unit_price: 0, tax_percent: 5 }])}>+ Add line</button>

      <div className="inv-totals">
        <p><span>Subtotal</span><span>{fmt(subtotal)}</span></p>
        {isIntrastate ? <><p><span>CGST</span><span>{fmt(totalCGST)}</span></p><p><span>SGST</span><span>{fmt(totalSGST)}</span></p></> : <p><span>IGST</span><span>{fmt(totalIGST)}</span></p>}
        <p className="grand"><span>Debit Total</span><span>{fmt(grand)}</span></p>
      </div>
      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

export function DebitNotesView({ debitNotes = [], invoices, businesses, parties, activeBiz, reload }) {
  const [showModal, setShowModal] = useState(false);
  const filtered = activeBiz ? debitNotes.filter(d => d.business_id === activeBiz) : debitNotes;

  async function handleSave(dnData, items) {
    await saveDebitNote(dnData, items);
    reload?.();
  }

  async function dlPDF(dn) {
    const items = await getDebitNoteItems(dn.id);
    const party = parties.find(p => p.id === dn.party_id) || {};
    const biz = businesses.find(b => b.id === dn.business_id) || {};
    printInvoice({ ...dn, invoice_number: dn.dn_number, issue_date: dn.dn_date, status: 'debit_note' }, items, party, biz, [], false, 'debit_note');
  }

  return <>
    <div className="filter-bar"><button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Debit Note</button></div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>DN Number</th><th>Date</th><th>Party</th><th>Against Invoice</th><th>Reason</th><th className="r">Amount</th><th>GST</th><th>Actions</th></tr></thead>
        <tbody>
          {filtered.map(dn => {
            const linkedInv = invoices.find(i => i.id === dn.invoice_id);
            const gstMode = dn.is_interstate === false ? 'intra' : 'inter';
            return <tr key={dn.id}>
              <td className="mono" style={{ color: 'var(--accent)' }}>{dn.dn_number}</td>
              <td className="mono" style={{ fontSize: 11 }}>{fmtDate(dn.dn_date)}</td>
              <td>{parties.find(p => p.id === dn.party_id)?.name || '—'}</td>
              <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{linkedInv?.invoice_number || '—'}</td>
              <td style={{ fontSize: 11, color: 'var(--text2)' }}>{dn.reason || '—'}</td>
              <td className="r mono" style={{ color: 'var(--accent)' }}>{fmt(dn.total)}</td>
              <td><span className={`gst-chip ${gstMode === 'intra' ? 'cgst' : 'igst'}`} style={{ fontSize: 9 }}>{gstMode === 'intra' ? 'C+S' : 'IGST'}</span></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => dlPDF(dn)}>⬇ PDF</button></td>
            </tr>;
          })}
          {filtered.length === 0 && <tr><td colSpan={8}><EmptyState icon="↗" message="No debit notes yet" sub="Create one to increase a taxable value or tax amount against an invoice" /></td></tr>}
        </tbody>
      </table>
    </div>
    {showModal && <DebitNoteModal onClose={() => setShowModal(false)} onSave={handleSave} businesses={businesses} parties={parties} invoices={invoices} debitNotes={debitNotes} activeBiz={activeBiz} />}
  </>;
}
