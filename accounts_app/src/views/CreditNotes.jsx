import { useState, useEffect, useRef } from 'react';
import { fmt, fmtDate, today, GST_RATES, gstType, calcLineTax, nextCNNum, getFYForDate, creditNoteDeadline, guessHSN, isHSNValid, MIN_HSN_DIGITS } from '../lib/constants.js';
import { saveCreditNote } from '../lib/db.js';
import { printInvoice } from '../lib/pdf.js';
import { Badge, ModalShell, FG, EmptyState } from '../components/ui.jsx';

function calcCNItem(it, isIntrastate) {
  const taxable = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  const { cgst, sgst, igst } = calcLineTax(taxable, Number(it.tax_percent || 0), isIntrastate);
  return { ...it, taxable, cgst, sgst, igst, lineTotal: taxable + cgst + sgst + igst };
}

export function CreditNoteModal({ onClose, onSave, businesses, parties, invoices, creditNotes, preInvoice }) {
  const initialBizId = preInvoice?.business_id || businesses[0]?.id || '';
  const [f, setF] = useState({
    business_id: initialBizId,
    party_id: preInvoice?.party_id || '',
    invoice_id: preInvoice?.id || '',
    // Scoped to this business only — Rule 53 numbering must be consecutive
    // per GSTIN, same reasoning as invoices.
    cn_number: nextCNNum(creditNotes.filter(c => c.business_id === initialBizId)),
    cn_date: today(),
    reason: '',
    notes: '',
    note_type: 'tax',
  });
  const [items, setItems] = useState([{ description: '', hsn_code: '', quantity: 1, unit_price: 0, tax_percent: 5 }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Re-scope the number if the user switches business before saving.
  const prevBizRef = useRef(initialBizId);
  useEffect(() => {
    if (f.business_id === prevBizRef.current) return;
    prevBizRef.current = f.business_id;
    setF(x => ({ ...x, cn_number: nextCNNum(creditNotes.filter(c => c.business_id === f.business_id)) }));
  }, [f.business_id]);

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
  function guessHSNOnBlur(idx) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      if (it.hsn_code && !it.hsn_auto) return it;
      const guess = guessHSN(it.description);
      if (!guess) return it.hsn_auto ? { ...it, hsn_code: '', hsn_auto: false, hsn_guess_label: null } : it;
      return { ...it, hsn_code: guess.hsn, hsn_auto: true, hsn_guess_label: guess.label };
    }));
  }
  function editHSN(idx, val) { setItems(prev => prev.map((it, i) => i !== idx ? it : { ...it, hsn_code: val, hsn_auto: false, hsn_guess_label: null })); }

  const linkedInvoice = invoices.find(i => i.id === f.invoice_id) || null;
  const deadline = linkedInvoice?.issue_date
    ? creditNoteDeadline(getFYForDate(linkedInvoice.issue_date))
    : null;
  const pastDeadline = deadline && f.cn_date > deadline;

  async function save() {
    if (!f.party_id) { setErr('Select a party'); return; }
    if (f.note_type === 'tax' && !f.invoice_id) {
      setErr('A tax credit note must reference the original invoice (Rule 53) — pick one, or switch to "Commercial / goodwill" if this isn\'t adjusting GST liability.');
      return;
    }
    if (f.note_type === 'tax' && pastDeadline) {
      setErr(`This is past the ${deadline} deadline to adjust GST liability for an invoice from FY ${getFYForDate(linkedInvoice.issue_date)} (Sec 34(2)) — it can still be issued, but won't be valid for reducing output tax. Switch to "Commercial / goodwill" instead.`);
      return;
    }
    const validItems = calc.filter(i => i.description?.trim());
    if (!validItems.length) { setErr('Add at least one item'); return; }
    // Tax notes mirror the original invoice for GST purposes (Rule 53) —
    // HSN is required on those. Commercial/goodwill notes don't touch GST
    // liability, so it's not enforced there.
    if (f.note_type === 'tax') {
      const badHSN = validItems.filter(i => !isHSNValid(i.hsn_code));
      if (badHSN.length) {
        setErr(`HSN code required (min ${MIN_HSN_DIGITS} digits) for: ${badHSN.map(i => i.description).join(', ')}`);
        return;
      }
    }
    setErr(''); setBusy(true);
    try {
      const isTax = f.note_type === 'tax';
      const cnData = {
        ...f,
        subtotal,
        // A commercial/goodwill note doesn't adjust GST output liability —
        // only a genuine reduction in the value of the original supply does
        // (Sec 15(3)(b)). Save it with zero tax so it never gets picked up
        // as a GST-reducing adjustment downstream.
        cgst_amount: isTax ? totalCGST : 0,
        sgst_amount: isTax ? totalSGST : 0,
        igst_amount: isTax ? totalIGST : 0,
        total: isTax ? grand : subtotal,
        is_interstate: !isIntrastate,
        status: 'issued',
      };
      const itemRows = validItems.map(it => ({
        description: it.description,
        hsn_code: it.hsn_code || null,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        tax_percent: Number(it.tax_percent),
        cgst_amount: isTax ? it.cgst : 0,
        sgst_amount: isTax ? it.sgst : 0,
        igst_amount: isTax ? it.igst : 0,
        amount: isTax ? it.lineTotal : it.taxable,
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
        <FG label="Type">
          <select value={f.note_type} onChange={e => setF(x => ({ ...x, note_type: e.target.value }))}>
            <option value="tax">Tax — reduces GST liability</option>
            <option value="commercial">Commercial / goodwill — no GST impact</option>
          </select>
        </FG>
        <FG label="Party *"><select value={f.party_id} onChange={e => setF(x => ({ ...x, party_id: e.target.value, invoice_id: '' }))}><option value="">Select…</option>{filteredParties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FG>
        <FG label={f.note_type === 'tax' ? 'Against Invoice *' : 'Against Invoice (optional)'}>
          <select value={f.invoice_id} onChange={e => setF(x => ({ ...x, invoice_id: e.target.value }))}>
            <option value="">{f.note_type === 'tax' ? 'Select…' : 'None'}</option>
            {filteredInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} — {fmt(i.total)}</option>)}
          </select>
        </FG>
      </div>
      <div className="form-row cols-3">
        <FG label="Reason"><select value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))}><option value="">Select…</option>{['Goods returned', 'Price correction', 'Defective goods', 'Duplicate invoice', 'Discount post-sale', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}</select></FG>
      </div>
      {f.note_type === 'tax' && deadline && (
        <div style={{ fontSize: 11, color: pastDeadline ? 'var(--red)' : 'var(--text3)', marginBottom: 10 }}>
          {pastDeadline ? '⚠ ' : ''}Deadline to adjust GST liability for FY {getFYForDate(linkedInvoice.issue_date)} invoices: {deadline} (Sec 34(2)).
          {pastDeadline ? ' This note is past that date — switch to "Commercial / goodwill" instead.' : ''}
        </div>
      )}

      <div className="section-title">Items Being Credited</div>
      <div className="line-items-head" style={{ gridTemplateColumns: '2fr 90px 70px 100px 60px 110px 28px' }}>
        <span>Description</span><span>HSN</span><span>Qty</span><span>Rate</span><span>GST%</span><span style={{ textAlign: 'right' }}>Amount</span><span></span>
      </div>
      {items.map((it, idx) => {
        const c = calcCNItem(it, isIntrastate);
        return (
          <div className="line-item-row" key={idx} style={{ gridTemplateColumns: '2fr 90px 70px 100px 60px 110px 28px' }}>
            <input placeholder="Item description" value={it.description} onChange={e => upd(idx, 'description', e.target.value)} onBlur={() => guessHSNOnBlur(idx)} />
            <div>
              <input placeholder="HSN" value={it.hsn_code || ''} onChange={e => editHSN(idx, e.target.value)}
                style={{ borderColor: it.hsn_auto ? 'var(--accent)' : undefined }}
                title={it.hsn_auto ? `Auto-filled from "${it.hsn_guess_label}"` : ''} />
              {it.hsn_auto && <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 2 }}>auto: {it.hsn_guess_label}</div>}
            </div>
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
        {f.note_type === 'tax' ? (
          <>
            {isIntrastate ? <><p><span>CGST</span><span>{fmt(totalCGST)}</span></p><p><span>SGST</span><span>{fmt(totalSGST)}</span></p></> : <p><span>IGST</span><span>{fmt(totalIGST)}</span></p>}
            <p className="grand"><span>Credit Total</span><span>{fmt(grand)}</span></p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 11, color: 'var(--text3)' }}><span>GST (not adjusted — commercial note)</span><span>—</span></p>
            <p className="grand"><span>Credit Total</span><span>{fmt(subtotal)}</span></p>
          </>
        )}
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
