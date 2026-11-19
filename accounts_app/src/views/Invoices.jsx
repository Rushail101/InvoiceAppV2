import { useState, useEffect, useRef } from 'react';
import { fmt, fmtDate, today, GST_RATES, PAY_MODES, INDIAN_STATES, gstType, calcLineTax, nextInvNum, getFY, getFYForDate, garmentGSTRate, isGSTINValid, guessHSN, isHSNValid, MIN_HSN_DIGITS, needsEwayBill, ewayBillThreshold, invoiceDue, isOverdue } from '../lib/constants.js';
import { saveInvoice, getInvoiceItems, updateInvoiceStatus, updateInvoice, deleteInvoice, cancelInvoice, savePaymentWithJournal, saveCreditNote, supabase } from '../lib/db.js';
import { printInvoice } from '../lib/pdf.js';
import { Badge, ModalShell, FG, PayHistory, EmptyState, toast } from '../components/ui.jsx';
import { LinkBankPaymentModal } from '../components/LinkBankPayment.jsx';
import { CreditNoteModal } from './CreditNotes.jsx';

// ─── LINE ITEM CALCULATION ─────────────────────────────────────────────────────
// priceMode: 'exclusive' (default) — unit_price is the pre-tax rate, GST is
// added on top. 'inclusive' — unit_price already has GST baked in, so the
// taxable value is backed out of it instead. Either way taxable/cgst/sgst/
// igst/lineTotal end up as real numbers stored per line, so nothing else
// downstream (PDF, ledgers, GSTR-1) needs to know which mode was used.
//
// invDiscRatio: an optional invoice-level discount, applied as a uniform
// fraction reduction to the (already line-discounted) taxable value BEFORE
// tax is computed — per Sec 15(3) CGST Act, discounts must reduce the
// taxable value, not the post-tax total. Scaling every line's taxable value
// by the same factor scales that line's tax by the same factor too, so the
// invoice grand total ends up scaled by exactly (1 - invDiscRatio), which is
// what lets the caller solve for the ratio from a target ₹ or % discount
// (see InvoiceModal) while keeping taxable + tax == total on every line.
function calcItem(it, isIntrastate, priceMode = 'exclusive', invDiscRatio = 0) {
  const base = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  const discAmt = base * (Number(it.discount_percent || 0) / 100);
  const net = base - discAmt;
  const taxPercent = Number(it.tax_percent || 0);
  let taxable = priceMode === 'inclusive' ? net / (1 + taxPercent / 100) : net;
  taxable = taxable * (1 - invDiscRatio);
  const { cgst, sgst, igst } = calcLineTax(taxable, taxPercent, isIntrastate);
  const lineTotal = taxable + cgst + sgst + igst;
  return { ...it, base, discAmt, taxable, cgst, sgst, igst, lineTotal };
}

// ─── INVOICE MODAL ─────────────────────────────────────────────────────────────
// `prefill` (optional) seeds a NEW document — Production Orders uses it to open
// a proforma / invoice with the order's garments, quantities, rates and GST.
export function InvoiceModal({ onClose, onSave, businesses, parties, catalogItems = [], editData, allInvoices, isProforma = false, activeBiz, purchaseMode = false, prefill = null, saveLabel }) {
  const isPF = isProforma || (editData?.status === 'proforma');
  // With "All Businesses" selected, start from the business you last saved a
  // document for, rather than whichever sorts first alphabetically.
  const lastBiz = (() => { try { return localStorage.getItem('np_last_doc_biz'); } catch (_) { return null; } })();
  const initialBizId = editData?.business_id || prefill?.business_id || activeBiz || (businesses.some(b => b.id === lastBiz) ? lastBiz : businesses[0]?.id) || '';
  const isPurchase = editData ? editData.type === 'purchase' : purchaseMode;
  const initialDate = editData?.issue_date || today();
  // Purchase bills carry the SUPPLIER's bill number, so a new one starts blank
  // instead of borrowing the next number from your own sales series.
  const suggestNumber = (bizId, date) => isPurchase ? '' :
    nextInvNum(allInvoices.filter(i => i.business_id === bizId), isPF, date);

  const [f, setF] = useState({
    business_id: initialBizId,
    party_id: editData?.party_id || prefill?.party_id || '',
    ops_order_key: editData?.ops_order_key || prefill?.ops_order_key || null,
    po_number: editData?.po_number || prefill?.po_number || null,
    // Sequence must be unique per GSTIN (Rule 46(b)) — scope the scan to this
    // business only, not every business's invoices, or numbers will skip
    // around whenever another business creates a document in between.
    invoice_number: editData?.invoice_number || suggestNumber(initialBizId, initialDate),
    type: editData?.type || (purchaseMode ? 'purchase' : 'sale'),
    issue_date: initialDate,
    due_date: editData?.due_date || prefill?.due_date || '',
    // A supplier bill is a real liability the moment it's recorded (its journal posts on save), so it starts as received.
    status: editData?.status || (isPF ? 'proforma' : isPurchase ? 'sent' : 'draft'),
    notes: editData?.notes || prefill?.notes || '',
    discount_percent: editData?.discount_percent || 0,
    discount_amount: editData?.discount_amount || 0,
    tds_amount: editData?.tds_amount || 0,
    price_mode: editData?.price_mode || 'exclusive',
    // Round-off defaults ON for new documents. It isn't stored in the DB, so for an
    // existing invoice infer it from the saved total (whole rupees = was rounded) so
    // that opening an old, unrounded invoice to edit doesn't silently change its total.
    round_off: editData
      ? (editData.round_off ?? (editData.total != null && Math.abs(Number(editData.total) - Math.round(Number(editData.total))) < 0.005))
      : true,
    ship_to_address: editData?.ship_to_address || '',
    itc_eligible: editData?.itc_eligible ?? true,
    itc_ineligible_reason: editData?.itc_ineligible_reason || '',
    purchase_order_ref: editData?.purchase_order_ref || '',
    grn_ref: editData?.grn_ref || '',
    reverse_charge: editData?.reverse_charge || false,
    // null = not yet locked, follows the party's live GST status (legacy
    // invoices, or a fresh one before save). '' = explicitly locked as
    // unregistered (B2C). A GSTIN string = explicitly locked as registered.
    // See effectiveGstin() in constants.js.
    party_gstin_snapshot: editData?.party_gstin_snapshot ?? null,
  });

  const [items, setItems] = useState(
    editData?.items?.length ? editData.items
      : prefill?.items?.length ? prefill.items
      : [{ description: '', hsn_code: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 5 }]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Switching the business on a NEW invoice must re-scope the number to that
  // business's own sequence — otherwise it'd keep whatever number the
  // previously-selected business generated. Skip this while editing an
  // existing invoice (its number is already fixed).
  // Same when the issue date moves into a different financial year (e.g. a
  // March invoice entered in April) — the series restarts per FY.
  const prevKeyRef = useRef(`${initialBizId}|${getFYForDate(initialDate)}`);
  const numberTouched = useRef(false);
  useEffect(() => {
    if (editData || isPurchase) return;
    const key = `${f.business_id}|${getFYForDate(f.issue_date)}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;
    if (!numberTouched.current) setF(x => ({ ...x, invoice_number: suggestNumber(f.business_id, f.issue_date) }));
  }, [f.business_id, f.issue_date]);

  // New proforma: take the number from the same database function the
  // operations app and the Telegram bot use, so all three always agree (it also
  // skips PO numbers already given to operations orders). If it isn't
  // available, the number worked out above (same rule) stays.
  useEffect(() => {
    if (!isPF || editData || isPurchase || prefill?.invoice_number || !supabase) return;
    if (getFYForDate(f.issue_date) !== getFY()) return;     // back-dated into another year: keep the local rule
    let live = true;
    supabase.rpc('next_proforma_number').then(({ data, error }) => {
      if (live && !error && data && !numberTouched.current) setF(x => ({ ...x, invoice_number: data }));
    });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bizObj = businesses.find(b => b.id === f.business_id) || {};
  const partyObj = parties.find(p => p.id === f.party_id) || {};
  const isIntrastate = gstType(bizObj.state, partyObj.state) === 'intrastate';
  const filteredParties = parties.filter(p => p.business_id === f.business_id);

  // Pass 1 — no invoice-level discount yet — just to know the pre-discount
  // grand total, which the ratio below is solved against.
  const calc0 = items.map(it => calcItem(it, isIntrastate, f.price_mode));
  const subtotal0 = calc0.reduce((s, i) => s + i.taxable, 0);
  const tax0 = calc0.reduce((s, i) => s + i.cgst + i.sgst + i.igst, 0);
  const grand0 = subtotal0 + tax0;

  // Invoice-level discount — % or flat ₹, whichever is non-zero (flat takes
  // priority). Converted to a uniform ratio applied to every line's taxable
  // value (pre-tax), not to the post-tax total — see calcItem() comment.
  // Because scaling every line's taxable by the same factor scales that
  // line's tax by the same factor too, grand0 * (1 - ratio) lands exactly
  // on the ₹ or % discount the user asked for.
  const invDiscPct = Number(f.discount_percent || 0);
  const invDiscFlat = Number(f.discount_amount || 0);
  const invDiscRatio = invDiscFlat > 0
    ? (grand0 > 0 ? Math.min(1, invDiscFlat / grand0) : 0)
    : Math.min(1, invDiscPct / 100);

  // Pass 2 — apply the resolved ratio to get the real, tax-consistent totals.
  const calc = items.map(it => calcItem(it, isIntrastate, f.price_mode, invDiscRatio));
  const subtotal = calc.reduce((s, i) => s + i.taxable, 0);
  const totalCGST = calc.reduce((s, i) => s + i.cgst, 0);
  const totalSGST = calc.reduce((s, i) => s + i.sgst, 0);
  const totalIGST = calc.reduce((s, i) => s + i.igst, 0);
  const totalTax = totalCGST + totalSGST + totalIGST;
  const grand = subtotal + totalTax;

  const invDiscAmt = grand0 - grand;
  const invDiscPctDisplay = grand0 > 0 ? (invDiscAmt / grand0) * 100 : 0;
  const finalTotal = grand;

  // Round-off — snaps the final payable amount to the nearest whole rupee
  // (standard practice on Indian tax invoices). The difference between the
  // exact and rounded figure is shown as its own "Round Off" line so nothing
  // is silently hidden.
  const roundedTotal = Math.round(finalTotal);
  const roundOffAmt = roundedTotal - finalTotal;
  const payableTotal = f.round_off ? roundedTotal : finalTotal;

  function upd(idx, field, val) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, [field]: val };
      // Auto-suggest the GST rate off the current 2-slab garment rule
      // (≤₹2,500/piece → 5%, above → 18%) whenever the rate is edited.
      // Only fires on a price edit, so a deliberate manual GST% pick
      // (e.g. for a non-apparel line) sticks unless the price changes again.
      if (field === 'unit_price') next.tax_percent = garmentGSTRate(val);
      return next;
    }));
  }
  function addRow() { setItems(p => [...p, { description: '', hsn_code: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 5 }]); }
  function remRow(idx) { setItems(p => p.filter((_, i) => i !== idx)); }

  // Best-effort HSN suggestion from the description, on blur (not every
  // keystroke — matching mid-word would flicker). Only fills a currently
  // blank field, and only overwrites a *previous auto-fill* (hsn_auto) if
  // the description changed enough to suggest something different — a
  // manually-typed HSN (hsn_auto unset) is never touched.
  function guessHSNOnBlur(idx) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      if (it.hsn_code && !it.hsn_auto) return it; // user typed their own — leave it
      const guess = guessHSN(it.description);
      if (!guess) return it.hsn_auto ? { ...it, hsn_code: '', hsn_auto: false, hsn_guess_label: null } : it;
      return { ...it, hsn_code: guess.hsn, hsn_auto: true, hsn_guess_label: guess.label };
    }));
  }
  function editHSN(idx, val) {
    setItems(prev => prev.map((it, i) => i !== idx ? it : { ...it, hsn_code: val, hsn_auto: false, hsn_guess_label: null }));
  }

  async function save(issue = false) {
    if (!f.party_id) { setErr(isPurchase ? 'Select a supplier' : 'Select a party'); return; }
    const num = (f.invoice_number || '').trim();
    if (!num) { setErr(isPurchase ? "Enter the supplier's bill number" : 'Enter an invoice number'); return; }
    // The database has a unique index on (business, number); catch the clash here with a clear message.
    const clash = allInvoices.find(i => i.id !== editData?.id && i.business_id === f.business_id
      && (i.invoice_number || '').trim().toLowerCase() === num.toLowerCase()
      && (!isPurchase || i.party_id === f.party_id));
    if (clash) { setErr(`Number ${num} is already used by another ${clash.type === 'purchase' ? 'purchase bill' : 'document'} in this business.`); return; }
    const validItems = calc.filter(i => i.description?.trim());
    if (!validItems.length) { setErr('Add at least one line item'); return; }
    // Rule 46(f) — HSN is mandatory on every line, minimum 4 digits below
    // ₹5cr turnover.
    const badHSN = validItems.filter(i => !isHSNValid(i.hsn_code));
    if (badHSN.length) {
      setErr(`HSN code required (min ${MIN_HSN_DIGITS} digits) for: ${badHSN.map(i => i.description).join(', ')}`);
      return;
    }
    setErr(''); setBusy(true);
    try {
      // Lock GST-registration status the moment this becomes a real
      // invoice — not read live later. Only auto-captures for a genuinely
      // new, non-proforma invoice; editing an existing one leaves a null
      // snapshot alone (still following the party's live record) unless
      // the "GST status for this invoice" control below was used.
      let gstinSnapshot = f.party_gstin_snapshot;
      if (!editData && !isPF && gstinSnapshot === null) gstinSnapshot = partyObj.gstin || '';
      const invData = {
        ...f,
        invoice_number: num,
        // "Save & issue" marks a draft as sent. Drafts are left out of GSTR-1,
        // so an invoice that silently stays a draft never gets reported.
        status: issue && f.status === 'draft' ? 'sent' : f.status,
        subtotal,
        cgst_amount: totalCGST,
        sgst_amount: totalSGST,
        igst_amount: totalIGST,
        tax_amount: totalTax,
        discount_amount: invDiscAmt,
        discount_percent: invDiscPctDisplay,
        total: payableTotal,
        is_interstate: !isIntrastate,
        party_gstin_snapshot: gstinSnapshot,
      };
      await onSave(invData, validItems, editData?.id);
      try { localStorage.setItem('np_last_doc_biz', f.business_id); } catch (_) {}
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const baseStatuses = isPF ? ['proforma', 'cancelled'] : ['draft', 'sent', 'partially_paid', 'paid', 'cancelled'];
  const statusOptions = baseStatuses.includes(f.status) ? baseStatuses : [...baseStatuses, f.status];

  const gstLabel = isIntrastate
    ? <span>GST split: <span className="gst-chip cgst">CGST</span> <span className="gst-chip sgst">SGST</span></span>
    : <span>GST type: <span className="gst-chip igst">IGST</span> (inter-state)</span>;

  return (
    <ModalShell title={editData ? (isPurchase ? 'Edit Purchase Bill' : isPF ? 'Edit Proforma' : 'Edit Invoice') : (isPF ? 'New Proforma Invoice' : (isPurchase ? 'New Purchase Bill' : 'New Tax Invoice'))} onClose={onClose} size="modal-xl"
      confirmClose="Close without saving? Anything you've entered will be lost."
      foot={<>
        <span className="hint" style={{ marginRight: 'auto', alignSelf: 'center' }}>Total <b style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>{fmt(payableTotal)}</b></span>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        {!isPF && !isPurchase && f.status === 'draft'
          ? <>
              <button className="btn btn-ghost" onClick={() => save(false)} disabled={busy} title="Keep as draft — drafts are not included in GSTR-1">Save draft</button>
              <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>{busy ? 'Saving…' : 'Save & issue'}</button>
            </>
          : <button className="btn btn-primary" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : saveLabel || (isPurchase ? 'Save bill' : isPF ? 'Save proforma' : 'Save invoice')}</button>}
      </>}>

      {isPF && <div className="pf-banner">⚡ Proforma Invoice — numbered in your PI series. Use "→ Invoice" to convert when approved.</div>}
      {f.ops_order_key && <div className="info-banner">🔗 Production order <b>{f.po_number || 'without PO number'}</b> — lines were filled from the order. Check HSN codes and quantities before saving.</div>}

      {/* Top fields */}
      <div className="form-row cols-3">
        {businesses.length > 1 && <FG label="Business">
          <select value={f.business_id} onChange={e => setF(x => ({ ...x, business_id: e.target.value, party_id: '' }))}>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FG>}
        <FG label={isPurchase ? 'Supplier Bill # *' : isPF ? 'Proforma #' : 'Invoice #'} note={isPurchase ? "As printed on the supplier's bill" : undefined}>
          <input value={f.invoice_number} disabled={!!editData?.gst_filed} placeholder={isPurchase ? "Supplier's bill number" : ''}
            onChange={e => { numberTouched.current = true; setF(x => ({ ...x, invoice_number: e.target.value })); }} />
          {editData?.gst_filed && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Locked — already marked GST-filed. Cancel and reissue instead of renumbering.</div>}
        </FG>
        <FG label="Status">
          <select value={f.status} onChange={e => setF(x => ({ ...x, status: e.target.value }))}>
            {statusOptions.map(s => <option key={s} value={s}>{s === 'sent' && isPurchase ? 'Received' : s.replace('_', ' ').replace(/^./, c => c.toUpperCase())}</option>)}
          </select>
        </FG>
      </div>

      <div className="form-row cols-3">
        <FG label={isPurchase ? 'Supplier *' : 'Party *'}>
          <select value={f.party_id} onChange={e => setF(x => ({ ...x, party_id: e.target.value }))}>
            <option value="">{isPurchase ? 'Select supplier…' : 'Select party…'}</option>
            {/* Suppliers first on a bill, clients first on an invoice */}
            {[...filteredParties].sort((a, b) => ((a.type === (isPurchase ? 'vendor' : 'client')) ? 0 : 1) - ((b.type === (isPurchase ? 'vendor' : 'client')) ? 0 : 1) || a.name.localeCompare(b.name))
              .map(p => <option key={p.id} value={p.id}>{p.name}{p.type !== (isPurchase ? 'vendor' : 'client') ? ` (${p.type})` : ''}</option>)}
          </select>
          {filteredParties.length === 0 && <div className="form-note" style={{ color: 'var(--amber)' }}>No parties for this business yet — add one under Sales → Parties.</div>}
        </FG>
        <FG label="Issue Date"><input type="date" value={f.issue_date} onChange={e => setF(x => ({ ...x, issue_date: e.target.value }))} /></FG>
        <FG label="Due Date"><input type="date" value={f.due_date} onChange={e => setF(x => ({ ...x, due_date: e.target.value }))} /></FG>
      </div>

      <div className="form-row cols-3">
        <FG label="Discount">
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <div style={{position:'relative',flex:1}}>
              <input type="number" min="0" max="100" step="0.01"
                style={{paddingRight:22,width:'100%'}}
                placeholder="0"
                value={f.discount_percent || ''}
                onChange={e => {
                  const pct = e.target.value;
                  const flat = pct ? (grand0 * (Number(pct) / 100)).toFixed(2) : 0;
                  setF(x => ({ ...x, discount_percent: pct, discount_amount: Number(flat) }));
                }} />
              <span style={{position:'absolute',right:7,top:'50%',transform:'translateY(-50%)',fontSize:11,color:'var(--text3)',pointerEvents:'none'}}>%</span>
            </div>
            <span style={{color:'var(--text3)',fontSize:11,flexShrink:0}}>or</span>
            <div style={{position:'relative',flex:1}}>
              <span style={{position:'absolute',left:7,top:'50%',transform:'translateY(-50%)',fontSize:11,color:'var(--text3)',pointerEvents:'none'}}>₹</span>
              <input type="number" min="0" step="0.01"
                style={{paddingLeft:18,width:'100%'}}
                placeholder="0"
                value={f.discount_amount || ''}
                onChange={e => {
                  const flat = e.target.value;
                  const pct = (flat && grand0 > 0) ? ((Number(flat) / grand0) * 100).toFixed(4) : 0;
                  setF(x => ({ ...x, discount_amount: Number(flat), discount_percent: Number(pct) }));
                }} />
            </div>
          </div>
          {invDiscAmt > 0 && <div style={{fontSize:10,color:'var(--text3)',marginTop:2}}>= ₹{invDiscAmt.toLocaleString('en-IN',{minimumFractionDigits:2})} ({invDiscPctDisplay.toFixed(2)}% off)</div>}
        </FG>
        <FG label="Notes / Terms"><input value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} placeholder="Due on Receipt" /></FG>
        <FG label="TDS Deducted (₹)"><input type="number" value={f.tds_amount} onChange={e => setF(x => ({ ...x, tds_amount: e.target.value }))} placeholder="0" /></FG>
      </div>
      {f.type === 'purchase' && (
        <>
          <div className="form-row cols-2">
            <FG label="PO Reference"><input value={f.purchase_order_ref} onChange={e => setF(x => ({ ...x, purchase_order_ref: e.target.value }))} placeholder="Optional PO #" /></FG>
            <FG label="GRN / Receipt Ref"><input value={f.grn_ref} onChange={e => setF(x => ({ ...x, grn_ref: e.target.value }))} placeholder="Optional GRN #" /></FG>
          </div>
          <div style={{ display:'flex', gap:14, alignItems:'center', margin:'4px 0 12px', padding:'9px 11px', background:'var(--bg2)', border:'1px solid var(--border1)', borderRadius:'var(--r)' }}>
            <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, cursor:'pointer' }}>
              <input type="checkbox" checked={!!f.itc_eligible} onChange={e => setF(x => ({ ...x, itc_eligible: e.target.checked, itc_ineligible_reason: e.target.checked ? '' : x.itc_ineligible_reason }))} />
              <span>ITC eligible</span>
            </label>
            {!f.itc_eligible && <input style={{ flex:1 }} value={f.itc_ineligible_reason} onChange={e => setF(x => ({ ...x, itc_ineligible_reason: e.target.value }))} placeholder="Reason for ineligible / blocked ITC" />}
            <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, cursor:'pointer' }}>
              <input type="checkbox" checked={!!f.reverse_charge} onChange={e => setF(x => ({ ...x, reverse_charge: e.target.checked }))} />
              <span>RCM purchase</span>
            </label>
            <span style={{ fontSize:10.5, color:'var(--text3)' }}>Normal supplier GST: keep RCM off.</span>
          </div>
        </>
      )}

      <div className="form-row">
        <FG label="Ship To (if different from billing address)">
          <textarea rows={2} placeholder="Leave blank to use the party's billing address on the printed invoice"
            value={f.ship_to_address} onChange={e => setF(x => ({ ...x, ship_to_address: e.target.value }))} />
        </FG>
      </div>
      {partyObj.gstin && !isGSTINValid(partyObj.gstin) && (
        <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 10 }}>
          ⚠ This party's GSTIN doesn't look valid — double-check it before sending. A wrong GSTIN will fail to match in the recipient's GSTR-2B and block their ITC.
        </div>
      )}
      {needsEwayBill(finalTotal, !isIntrastate, bizObj.state) && (
        <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 10 }}>
          ⚠ This invoice is above the e-way bill threshold (₹{ewayBillThreshold(!isIntrastate, bizObj.state).toLocaleString('en-IN')} for {isIntrastate ? `intra-state in ${bizObj.state || 'this state'}` : 'inter-state'} movement) — generate one on the e-way bill portal before dispatch if goods are moving by road.
        </div>
      )}
      {(partyObj.gstin || f.party_gstin_snapshot) && (
        <div style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 5 }}>
            GST status for THIS invoice (B2B vs B2C in GSTR-1)
          </label>
          <select
            value={f.party_gstin_snapshot === null ? 'auto' : f.party_gstin_snapshot === '' ? 'unregistered' : 'registered'}
            onChange={e => {
              const v = e.target.value;
              setF(x => ({ ...x, party_gstin_snapshot: v === 'auto' ? null : v === 'unregistered' ? '' : (partyObj.gstin || '') }));
            }}
            style={{ fontSize: 12 }}
          >
            <option value="auto">Auto — follow this party's current record{partyObj.gstin ? ` (currently registered: ${partyObj.gstin})` : ' (currently not registered)'}</option>
            {partyObj.gstin && <option value="registered">Registered — GSTIN {partyObj.gstin} (lock as B2B)</option>}
            <option value="unregistered">Not registered at the time of this invoice (lock as B2C)</option>
          </select>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
            Use this if the party got their GSTIN AFTER this invoice was issued — "Auto" would otherwise silently reclassify it as B2B using their current status, which can shift figures on a GSTR-1 you've already filed.
          </div>
        </div>
      )}

      {/* GST type indicator */}
      {f.party_id && (
        <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text2)' }}>
          {gstLabel}
          {bizObj.state && partyObj.state && <span style={{ marginLeft: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 11 }}>({bizObj.state} → {partyObj.state})</span>}
        </div>
      )}

      {/* Line items */}
      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Line Items</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'none', fontWeight: 400 }}>Rates entered below are:</span>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border2)' }}>
            <button type="button"
              onClick={() => setF(p => ({ ...p, price_mode: 'exclusive' }))}
              style={{ padding: '4px 10px', fontSize: 11, border: 'none', cursor: 'pointer', background: f.price_mode === 'exclusive' ? 'var(--accent)' : 'var(--bg2)', color: f.price_mode === 'exclusive' ? '#0d0d0d' : 'var(--text2)', fontWeight: f.price_mode === 'exclusive' ? 700 : 400 }}>
              GST added on top
            </button>
            <button type="button"
              onClick={() => setF(p => ({ ...p, price_mode: 'inclusive' }))}
              style={{ padding: '4px 10px', fontSize: 11, border: 'none', cursor: 'pointer', background: f.price_mode === 'inclusive' ? 'var(--accent)' : 'var(--bg2)', color: f.price_mode === 'inclusive' ? '#0d0d0d' : 'var(--text2)', fontWeight: f.price_mode === 'inclusive' ? 700 : 400 }}>
              GST already included
            </button>
          </div>
        </div>
      </div>
      {f.price_mode === 'inclusive' && (
        <div style={{ fontSize: 10.5, color: 'var(--amber)', marginBottom: 6 }}>
          Rate × Qty is treated as the final price including GST — the taxable value and tax split are backed out of it, not added on top.
        </div>
      )}
      <div className="line-items-head" style={{ gridTemplateColumns: '2fr 90px 70px 100px 72px 60px 100px 28px' }}>
        <span>Description</span><span>HSN</span><span>Qty</span><span>Rate</span><span>Disc%</span><span>GST%</span><span style={{ textAlign: 'right' }}>Amount</span><span></span>
      </div>

      {items.map((it, idx) => {
        const c = calcItem(it, isIntrastate, f.price_mode);
        return (
          <div className="line-item-row" key={idx} style={{ gridTemplateColumns: '2fr 90px 70px 100px 72px 60px 100px 28px' }}>
            <div style={{ position: 'relative', display: 'flex', gap: 3 }}>
              <input placeholder="Product / service" value={it.description} onChange={e => upd(idx, 'description', e.target.value)} onBlur={() => guessHSNOnBlur(idx)} style={{ flex: 1 }} />
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
                      hsn_auto: false, hsn_guess_label: null,
                      unit_price: item.sale_price || it2.unit_price,
                      tax_percent: item.tax_percent ?? it2.tax_percent,
                    }));
                  }}
                >
                  <option value="">📦 Pick…</option>
                  {(() => {
                    // Group by brand so "T-Shirt" for two different brands/prices stays distinguishable.
                    const list = catalogItems.filter(i => i.business_id === f.business_id);
                    const brands = [...new Set(list.map(i => (i.brand || '').trim()))].sort((a, b) => (a || '~').localeCompare(b || '~'));
                    const opt = i => <option key={i.id} value={i.id}>{i.name} — ₹{Number(i.sale_price || 0).toLocaleString('en-IN')}</option>;
                    return brands.map(b => (
                      <optgroup key={b || '_generic'} label={b || 'No brand'}>
                        {list.filter(i => (i.brand || '').trim() === b).sort((x, y) => x.name.localeCompare(y.name)).map(opt)}
                      </optgroup>
                    ));
                  })()}
                </select>
              )}
            </div>
            <div>
              <input placeholder="HSN" value={it.hsn_code || ''} onChange={e => editHSN(idx, e.target.value)}
                style={{ fontFamily: 'var(--mono)', fontSize: 11, borderColor: it.hsn_auto ? 'var(--accent)' : undefined }}
                title={it.hsn_auto ? `Auto-filled from "${it.hsn_guess_label}" — check it, then edit if needed` : ''} />
              {it.hsn_auto && <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 2 }}>auto: {it.hsn_guess_label}</div>}
            </div>
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
        <p style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: 'var(--text2)' }}>
              <input type="checkbox" checked={f.round_off} onChange={e => setF(x => ({ ...x, round_off: e.target.checked }))} />
              Round off to nearest ₹1
            </label>
          </span>
          {f.round_off && <span>{roundOffAmt >= 0 ? '+' : '-'}{fmt(Math.abs(roundOffAmt))}</span>}
        </p>
        <p className="grand"><span>Total</span><span>{fmt(payableTotal)}</span></p>
      </div>

      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── PAYMENT MODAL ─────────────────────────────────────────────────────────────
export function PaymentModal({ onClose, onSave, invoice, existingPayments, parties = [], allPayments = [], creditNotes = [], onLinked }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const totalPaid = existingPayments.reduce((s, p) => s + Number(p.amount), 0);
  // TDS the customer withheld and credit notes against this invoice also reduce what's left to collect.
  const balance = invoiceDue(invoice, existingPayments, creditNotes);
  const tds = Number(invoice.tds_amount || 0);
  const cnTotal = creditNotes.filter(c => c.status !== 'cancelled').reduce((s, c) => s + Number(c.total || 0), 0);
  const [f, setF] = useState({ amount: balance.toFixed(2), payment_date: today(), method: 'UPI', reference: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const amt = Number(f.amount);
    if (!amt || amt <= 0) { setErr('Enter a valid amount'); return; }
    if (amt > balance + 0.01) { setErr(`Max allowed: ${fmt(balance)}`); return; }
    setBusy(true);
    try {
      await onSave({ ...f, amount: amt, invoice_id: invoice.id, business_id: invoice.business_id, party_id: invoice.party_id, invoice_type: invoice.type });
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title={invoice.status === 'proforma' ? `Record Advance — ${invoice.invoice_number}` : 'Record Payment'} onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : invoice.status === 'proforma' ? 'Record Advance' : 'Record Payment'}</button></>}>
      {invoice.status === 'proforma' && (() => {
        const pct = invoice.total > 0 ? Math.min(100, Math.round((totalPaid / Number(invoice.total)) * 100)) : 0;
        const remaining = Math.max(0, Number(invoice.total) - totalPaid);
        return (
          <div style={{ background: '#0e1a0e', border: '1px solid #1e3d1e', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#4ade80' }}>⚡ Proforma — Advance Collection</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: pct === 100 ? '#4ade80' : 'var(--amber)' }}>{pct}% collected</span>
            </div>
            {/* Progress bar */}
            <div style={{ height: 6, background: 'var(--bg1)', borderRadius: 99, overflow: 'hidden', marginBottom: 10 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#4ade80' : '#fbbf24', borderRadius: 99, transition: 'width 0.4s' }} />
            </div>
            {/* Amount breakdown */}
            <div style={{ display: 'flex', gap: 18, fontSize: 12, fontFamily: 'var(--mono)' }}>
              <span style={{ color: 'var(--text3)' }}>Invoice total <strong style={{ color: 'var(--text1)' }}>{fmt(invoice.total)}</strong></span>
              <span style={{ color: 'var(--text3)' }}>Received <strong style={{ color: '#4ade80' }}>{fmt(totalPaid)}</strong></span>
              <span style={{ color: 'var(--text3)' }}>Remaining <strong style={{ color: remaining > 0 ? 'var(--amber)' : '#4ade80' }}>{fmt(remaining)}</strong></span>
            </div>
            {pct < 100 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)' }}>
                Tax invoice + invoice number will be assigned automatically when full payment is received.
              </div>
            )}
          </div>
        );
      })()}
      <PayHistory payments={existingPayments} invoiceTotal={Number(invoice.total) - tds - cnTotal} />
      {(tds > 0 || cnTotal > 0) && (
        <div className="hint" style={{ marginTop: 6 }}>
          Balance already allows for {tds > 0 ? `TDS of ${fmt(tds)}` : ''}{tds > 0 && cnTotal > 0 ? ' and ' : ''}{cnTotal > 0 ? `credit notes of ${fmt(cnTotal)}` : ''}.
        </div>
      )}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setLinkOpen(true)}>🔗 Link bank payment</button>
        <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Pick the imported bank transaction(s) that paid this, instead of typing the payment in.</span>
      </div>
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
      {linkOpen && <LinkBankPaymentModal invoice={invoice} parties={parties} allPayments={allPayments} onClose={() => setLinkOpen(false)} onLinked={onLinked} />}
    </ModalShell>
  );
}

// ─── MONTH HELPERS ─────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getMonthKey(dateStr) {
  if (!dateStr) return 'unknown';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMonthKey(key) {
  if (key === 'unknown') return 'Unknown Date';
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

// ─── INVOICES VIEW ─────────────────────────────────────────────────────────────
export function InvoicesView({ invoices, businesses, parties, activeBiz, reload, payments, creditNotes, catalogItems = [], purchaseMode = false, isProforma = false, action = null, onActionDone }) {
  const [search, setSearch] = useState('');
  const [groupByMonth, setGroupByMonth] = useState(true);
  const [cnFor, setCnFor] = useState(null); // invoice a credit note is being raised against
  const [activeMonth, setActiveMonth] = useState(null); // null = show all months expanded
  const [sf, setSf] = useState('');
  const [showInv, setShowInv] = useState(false);
  const [showPF, setShowPF] = useState(false);
  const [editData, setEditData] = useState(null);
  const [payInv, setPayInv] = useState(null);

  // Instructions handed over from the dashboard ("+ New Invoice", "View overdue"…), applied once.
  useEffect(() => {
    if (!action) return;
    if (action.create) { setEditData(null); if (isProforma) setShowPF(true); else setShowInv(true); }
    if (action.filter) setSf(action.filter);
    onActionDone?.();
  }, [action?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const paysByInv = {};
  payments.forEach(p => { if (!paysByInv[p.invoice_id]) paysByInv[p.invoice_id] = []; paysByInv[p.invoice_id].push(p); });

  const cnsByInv = {};
  creditNotes.forEach(cn => { if (!cnsByInv[cn.invoice_id]) cnsByInv[cn.invoice_id] = []; cnsByInv[cn.invoice_id].push(cn); });

  const dueOf = inv => invoiceDue(inv, paysByInv[inv.id] || [], cnsByInv[inv.id] || []);
  const partyName = id => parties.find(p => p.id === id)?.name || '';

  // Three screens share this view: Invoices (tax invoices), Proforma (proformas
  // only) and Purchase Bills. Before, the Proforma page showed every invoice.
  const inScope = i => (activeBiz ? i.business_id === activeBiz : true)
    && (purchaseMode ? i.type === 'purchase'
      : i.type !== 'purchase' && (isProforma ? i.status === 'proforma' : i.status !== 'proforma'));
  const scoped = invoices.filter(inScope);
  const filtered = scoped.filter(i => {
    const stMatch = !sf ? true : sf === 'overdue' ? lateOf(i) : sf === 'unpaid' ? dueOf(i) > 0.01 && isLive(i) : i.status === sf;
    const s = search.trim().toLowerCase();
    const nameMatch = !s || (i.invoice_number || '').toLowerCase().includes(s) || partyName(i.party_id).toLowerCase().includes(s)
      || (i.proforma_number || '').toLowerCase().includes(s);
    return stMatch && nameMatch;
  }).sort((a, b) => (b.issue_date || '').localeCompare(a.issue_date || '') || (b.invoice_number || '').localeCompare(a.invoice_number || '', undefined, { numeric: true }));

  // Headline numbers for whatever is in scope (ignores the search box on purpose).
  // Purchase bills are booked when recorded, so a 'draft' bill still counts; sales drafts don't.
  const isLive = i => i.status !== 'cancelled' && (purchaseMode || i.status !== 'draft');
  const lateOf = i => isOverdue(purchaseMode && i.status === 'draft' ? { ...i, status: 'sent' } : i, dueOf(i));
  const live = scoped.filter(isLive);
  const summary = {
    count: live.length,
    total: live.reduce((s, i) => s + Number(i.total || 0), 0),
    outstanding: live.reduce((s, i) => s + Math.max(0, dueOf(i)), 0),
    overdue: live.filter(lateOf),
    drafts: scoped.filter(i => i.status === 'draft').length,
  };

  // Group by month (YYYY-MM key, sorted newest first)
  const monthGroups = filtered.reduce((acc, inv) => {
    const key = getMonthKey(inv.issue_date);
    if (!acc[key]) acc[key] = [];
    acc[key].push(inv);
    return acc;
  }, {});
  const sortedMonthKeys = Object.keys(monthGroups).sort((a, b) => b.localeCompare(a));

  // Set default active month to most recent when switching to tab mode
  function handleGroupToggle() {
    const newMode = !groupByMonth;
    setGroupByMonth(newMode);
    if (newMode && !activeMonth && sortedMonthKeys.length) {
      setActiveMonth(sortedMonthKeys[0]);
    }
  }

  // Fall back to the newest month whenever the selected one has nothing in it
  // (first load, or after a filter change empties it) — previously the screen
  // just showed the month tabs with no table underneath.
  const shownMonth = activeMonth && monthGroups[activeMonth] ? activeMonth : sortedMonthKeys[0] || null;
  // Searching or filtering looks across every month, so show one flat list.
  const flatList = !groupByMonth || !!search.trim() || !!sf;

  async function handleSave(invData, items, id) {
    await saveInvoice(invData, items, id);
    toast(`${invData.type === 'purchase' ? 'Purchase bill' : invData.status === 'proforma' ? 'Proforma' : 'Invoice'} ${invData.invoice_number} saved`, 'success');
    reload();
  }

  // After a payment exists (typed in, or linked from the bank): raise the tax invoice when a proforma is
  // fully paid, otherwise keep the invoice's paid / partially-paid status in step.
  async function afterPayment(invoiceId, amt, paymentDate, { skipStatus = false } = {}) {
    const inv = invoices.find(i => i.id === invoiceId);
    const isFullyPaid = dueOf(inv) - amt <= 0.01;
    try {
      if (inv?.status === 'proforma') {
        if (isFullyPaid) {
          // Auto-convert: assign next invoice number, mark paid, use date of final payment as invoice date
          const invoiceDate = paymentDate || today();
          const newNum = nextInvNum(invoices.filter(i => i.business_id === inv.business_id), false, invoiceDate);
          const party = parties.find(p => p.id === inv.party_id);
          await updateInvoice(invoiceId, { status: 'paid', invoice_number: newNum, proforma_number: inv.invoice_number, issue_date: invoiceDate, party_gstin_snapshot: party?.gstin || '' });
          toast(`Full payment received — Tax Invoice ${newNum} raised on ${fmtDate(invoiceDate)}. It now shows in GSTR-1 for that month.`, 'success', 7000);
        } else toast('Advance recorded', 'success');
      } else {
        if (!skipStatus) await updateInvoiceStatus(invoiceId, isFullyPaid ? 'paid' : 'partially_paid');
        toast(isFullyPaid ? `${inv?.invoice_number} is now fully paid` : 'Payment recorded', 'success');
      }
    } catch (e) { toast(e.message, 'error'); }
    reload();
  }
  async function handlePayment(data) {
    const res = await savePaymentWithJournal(data);
    if (res?.skipped) toast(`Payment saved, but no journal entry was posted (${res.skipReason === 'account_not_found' ? 'a needed account is missing from the Chart of Accounts' : res.skipReason}). Re-post it later from Journal Health.`, 'warn', 9000);
    await afterPayment(data.invoice_id, Number(data.amount), data.payment_date);
  }

  async function convertProforma(inv) {
    const totalPaid = (paysByInv[inv.id] || []).reduce((s, p) => s + Number(p.amount), 0);
    const pct = inv.total > 0 ? Math.round((totalPaid / Number(inv.total)) * 100) : 0;
    // Issue date = the date goods/services are actually supplied (Sec 31
    // CGST Act — the invoice must be issued at/before time of supply), so
    // this is the date you're converting on (i.e. when it's actually going
    // out/delivered), NOT the date payment happened to arrive. Payment
    // timing has no bearing on when the supply occurred.
    const conversionDate = today();
    // Lock B2B/B2C classification to the party's GST status right now, at
    // the moment this actually becomes a real invoice — see effectiveGstin()
    // in constants.js. Stops a later GSTIN addition from silently
    // reclassifying this invoice.
    const party = parties.find(p => p.id === inv.party_id);
    const gstinSnapshot = party?.gstin || '';
    const newNum = nextInvNum(invoices.filter(i => i.business_id === inv.business_id), false, conversionDate);
    if (!confirm(`Convert ${inv.invoice_number} to Tax Invoice ${newNum}?\n\nPayment received: ₹${totalPaid.toLocaleString('en-IN')} of ₹${Number(inv.total).toLocaleString('en-IN')} (${pct}%)\n\nIssue date will be set to today (${fmtDate(conversionDate)}) — the date of conversion/delivery, not the payment date. Continue?`)) return;
    const status = totalPaid >= Number(inv.total) - 0.01 ? 'paid' : totalPaid > 0 ? 'partially_paid' : 'sent';
    try {
      await updateInvoice(inv.id, { status, invoice_number: newNum, proforma_number: inv.invoice_number, issue_date: conversionDate, party_gstin_snapshot: gstinSnapshot });
      toast(`${inv.invoice_number} converted to Tax Invoice ${newNum}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    reload();
  }

  async function del(id) {
    const inv = invoices.find(i => i.id === id);
    // Once an invoice has actually been issued (sent/paid) or marked
    // GST-filed, records must be retained — Sec 35 CGST Act / Rule 56.
    // Cancel it instead (keeps the row + number, just voids it) rather
    // than erasing the audit trail. Only a never-sent draft/proforma can
    // be hard-deleted.
    const hasPayments = (paysByInv[id] || []).length > 0;
    try {
      if (inv?.gst_filed || ['sent', 'paid', 'partially_paid'].includes(inv?.status)) {
        if (!confirm(`${inv.invoice_number} has already been issued${inv.gst_filed ? ' and marked GST-filed' : ''} — it can't be deleted.\n\nCancel it instead? (keeps the record and number, marks it void; raise a credit note if goods/money need to be reversed)`)) return;
        await cancelInvoice(id);
        toast(`${inv.invoice_number} cancelled`, 'success');
      } else {
        if (!confirm(`Delete ${inv?.invoice_number || 'this document'}?${hasPayments ? '\n\nIts recorded payments and their journal entries will be deleted too.' : ''} This cannot be undone.`)) return;
        await deleteInvoice(id);
        toast(`${inv?.invoice_number || 'Document'} deleted`, 'success');
      }
    } catch (e) { toast(e.message, 'error'); }
    reload();
  }

  async function dlPDF(inv) {
    const { supabase } = await import('../lib/db.js');
    const { data: items } = await supabase.from('invoice_items').select('*').eq('invoice_id', inv.id);
    const party = parties.find(p => p.id === inv.party_id) || {};
    const biz = businesses.find(b => b.id === inv.business_id) || {};
    printInvoice(inv, items || [], party, biz, paysByInv[inv.id] || []);
  }

  async function openEdit(inv) {
    // NOTE: line items live in a separate invoice_items table and were never
    // being fetched here — the modal was opening with only the invoice header
    // (party, dates, totals), so its item list always started empty on edit,
    // even though the items themselves were safely sitting in the database
    // the whole time. Delivery Challans already do this correctly (openEdit
    // there calls getChallanItems first) — this mirrors that.
    const items = await getInvoiceItems(inv.id);
    setEditData({ ...inv, items });
    setShowInv(true);
  }

  async function autoNumber() {
    // Only renumber invoices that haven't actually gone out yet. Once an
    // invoice is sent/paid or marked GST-filed, the customer has that
    // number on their copy and/or it's already on the GST portal —
    // rewriting it at that point creates a mismatch between your books,
    // their copy, and what's filed. Only 'draft' invoices are fair game.
    // Sale drafts only — this used to test i.type !== 'proforma' (type is never
    // 'proforma'), so draft PURCHASE bills got their supplier numbers overwritten.
    const toNumber = invoices
      .filter(i => i.type === 'sale' && i.status === 'draft' && !i.gst_filed)
      .filter(i => activeBiz ? i.business_id === activeBiz : true);

    if (!toNumber.length) { alert('No draft invoices found to number. Sent, paid, or GST-filed invoices are left alone — cancel and reissue those instead of renumbering.'); return; }

    // Sort by date ascending, existing number as tiebreaker
    const sorted = [...toNumber].sort((a, b) => {
      const diff = new Date(a.issue_date) - new Date(b.issue_date);
      if (diff !== 0) return diff;
      return (a.invoice_number || '').localeCompare(b.invoice_number || '');
    });

    // Assign numbers per FY, per business (Rule 46(b) — sequence must be
    // consecutive within one GSTIN; keying only by FY would interleave two
    // businesses' drafts into one shared sequence if activeBiz isn't set).
    // Each series continues AFTER the highest number already issued (sent/paid
    // invoices keep their numbers). Starting every series at 1001 used to hand
    // drafts numbers that issued invoices already had.
    const draftIds = new Set(toNumber.map(i => i.id));
    const fyCounters = {};
    const startFor = (bizId, fy) => {
      const pat = new RegExp(`^${fy}/(\\d+)$`);
      let max = 1000;
      invoices.forEach(i => {
        if (i.business_id !== bizId || i.type !== 'sale' || draftIds.has(i.id)) return;
        const m = (i.invoice_number || '').match(pat);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
      return max + 1;
    };
    const updates = sorted.map(inv => {
      const fy = getFYForDate(inv.issue_date);
      const key = `${inv.business_id}|${fy}`;
      if (!fyCounters[key]) fyCounters[key] = startFor(inv.business_id, fy);
      const num = fyCounters[key]++;
      return { id: inv.id, old: inv.invoice_number, newNum: `${fy}/${num}` };
    });

    // Preview confirmation
    const preview = updates.slice(0, 8).map(u => `  ${u.old}  →  ${u.newNum}`).join('\n');
    const more = updates.length > 8 ? `\n  ...and ${updates.length - 8} more` : '';
    const ok = confirm(`Auto-Number Invoices\n\nThis will renumber ${updates.length} invoice(s) by date:\n\n${preview}${more}\n\nThis overwrites existing numbers. Continue?`);
    if (!ok) return;

    // Two passes: park every draft on a temporary number first, so swapping
    // numbers between drafts can't trip the unique (business, number) index.
    try {
      for (const u of updates) await updateInvoice(u.id, { invoice_number: `TMP-${u.id.slice(0, 8)}` });
      for (const u of updates) await updateInvoice(u.id, { invoice_number: u.newNum });
      toast(`${updates.length} draft invoice${updates.length === 1 ? '' : 's'} renumbered`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    reload();
  }

  async function openCreditNote(inv) {
    // Pre-fill the credit note with the invoice's own lines; the user trims
    // quantities down to what is actually being returned / corrected.
    try {
      const items = await getInvoiceItems(inv.id);
      setCnFor({ inv, items });
    } catch (e) { toast(e.message, 'error'); }
  }
  async function saveCN(cnData, items) {
    await saveCreditNote(cnData, items);
    toast(`Credit note ${cnData.cn_number} issued`, 'success');
    reload();
  }

  const docWord = purchaseMode ? 'purchase bills' : isProforma ? 'proformas' : 'invoices';

  // Render a table of invoices for a given list
  function renderTable(list) {
    if (!list.length) return <EmptyState icon="📄" message={`No ${docWord} match`} sub={search || sf ? 'Try clearing the search or status filter' : undefined} />;
    const listTotal = list.reduce((s, i) => s + Number(i.total || 0), 0);
    const listDue = list.filter(isLive).reduce((s, i) => s + Math.max(0, dueOf(i)), 0);
    return (
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>{purchaseMode ? 'Supplier Bill #' : isProforma ? 'Proforma #' : 'Invoice #'}</th><th>{purchaseMode ? 'Supplier' : 'Party'}</th><th>Date</th><th>Due</th>
            <th className="r">Total</th><th className="r">{isProforma ? 'Advance' : 'Paid'}</th><th className="r">Balance</th>
            <th>GST</th>{purchaseMode && <th>ITC</th>}<th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {list.map(inv => {
              const ip = paysByInv[inv.id] || [];
              const paid = ip.reduce((s, p) => s + Number(p.amount), 0);
              const bal = dueOf(inv);
              const late = lateOf(inv);
              const gstMode = inv.is_interstate === false ? 'intra' : 'inter';
              const cancelled = inv.status === 'cancelled';
              return (
                <tr key={inv.id} style={cancelled ? { opacity: 0.55 } : undefined}>
                  <td className="mono">
                    {inv.invoice_number}
                    {inv.proforma_number && <div style={{ fontSize: 9.5, color: 'var(--text3)' }}>from {inv.proforma_number}</div>}
                  </td>
                  <td style={{ fontWeight: 500 }}>{partyName(inv.party_id) || '—'}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtDate(inv.issue_date)}</td>
                  <td className="mono" style={{ fontSize: 11, color: late ? 'var(--red)' : 'var(--text3)' }} title={late ? 'Overdue' : undefined}>
                    {fmtDate(inv.due_date)}{late && <div style={{ fontSize: 9.5 }}>{Math.floor((new Date(today()) - new Date(inv.due_date)) / 86400000)}d late</div>}
                  </td>
                  <td className="r mono">{fmt(inv.total)}</td>
                  <td className="r mono" style={{ color: 'var(--green)', fontSize: 11 }}>{paid > 0 ? fmt(paid) : '—'}</td>
                  <td className="r mono" style={{ color: cancelled ? 'var(--text3)' : bal > 0.01 ? (late ? 'var(--red)' : 'var(--amber)') : 'var(--text3)', fontSize: 11 }}>{cancelled ? '—' : bal > 0.01 ? fmt(bal) : '✓'}</td>
                  <td><span className={`gst-chip ${gstMode === 'intra' ? 'cgst' : 'igst'}`} style={{ fontSize: 9 }}>{gstMode === 'intra' ? 'C+S' : 'IGST'}</span></td>
                  {purchaseMode && <td><span className={`gst-chip ${inv.itc_eligible === false ? 'igst' : 'cgst'}`} style={{ fontSize: 9 }}>{inv.itc_eligible === false ? 'Blocked' : 'Eligible'}</span></td>}
                  <td><Badge status={late ? 'overdue' : inv.status} /></td>
                  <td>
                    <div className="row-actions">
                      {inv.status === 'proforma' && <button className="btn btn-warning btn-sm" title="Manually assign invoice number now" onClick={() => convertProforma(inv)}>→ Invoice</button>}
                      {!['paid', 'cancelled'].includes(inv.status) && bal > 0.01 && <button className="btn btn-ghost btn-sm" title={purchaseMode ? 'Record a payment to the supplier' : 'Record a payment received'} onClick={() => setPayInv(inv)}>💰 {isProforma ? 'Advance' : 'Pay'}</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => dlPDF(inv)} title="Download / print PDF">PDF</button>
                      {!cancelled && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(inv)}>Edit</button>}
                      {!purchaseMode && !isProforma && ['sent', 'paid', 'partially_paid'].includes(inv.status) && <button className="btn btn-ghost btn-sm" title="Raise a credit note against this invoice (return / price correction)" onClick={() => openCreditNote(inv)}>↩ CN</button>}
                      {!cancelled && <button className="btn btn-danger btn-sm" onClick={() => del(inv.id)} title={['sent', 'paid', 'partially_paid'].includes(inv.status) || inv.gst_filed ? 'Issued documents are cancelled, not deleted' : 'Delete'}>{['sent', 'paid', 'partially_paid'].includes(inv.status) || inv.gst_filed ? 'Cancel' : 'Del'}</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--bg3)' }}>
              <td colSpan={4} style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{list.length} {list.length === 1 ? 'document' : 'documents'}</td>
              <td className="r mono" style={{ fontWeight: 600 }}>{fmt(listTotal)}</td>
              <td></td>
              <td className="r mono" style={{ fontWeight: 600, color: listDue > 0.01 ? 'var(--amber)' : 'var(--text3)' }}>{listDue > 0.01 ? fmt(listDue) : '—'}</td>
              <td colSpan={purchaseMode ? 4 : 3}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  // Month summary pill
  function MonthSummary({ list }) {
    const total = list.reduce((s, i) => s + Number(i.total), 0);
    const outstanding = list.filter(isLive).reduce((s, i) => s + Math.max(0, dueOf(i)), 0);
    const proformaCount = list.filter(i => i.status === 'proforma').length;
    return (
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
        <span style={{ color: 'var(--text2)' }}>{list.length} doc{list.length !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span style={{ color: 'var(--text)' }}>{fmt(total)}</span>
        {outstanding > 0.01 && <><span>·</span><span style={{ color: 'var(--amber)' }}>{fmt(outstanding)} due</span></>}
        {proformaCount > 0 && <><span>·</span><span style={{ color: 'var(--purple)' }}>{proformaCount} PF</span></>}
      </span>
    );
  }

  const statusChips = [
    ['', 'All'],
    ...(isProforma ? [] : [['unpaid', purchaseMode ? 'Unpaid' : 'Outstanding'], ['overdue', 'Overdue'], ['draft', 'Drafts'], ['partially_paid', 'Part paid'], ['paid', 'Paid']]),
    ['cancelled', 'Cancelled'],
  ];

  return (
    <>
      {/* ── Headline numbers ── */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="stat-card blue clickable" onClick={() => setSf('')}><div className="stat-label">{isProforma ? 'Open proformas' : purchaseMode ? 'Bills' : 'Invoices issued'}</div><div className="stat-val blue">{summary.count}</div><div className="stat-sub">{fmt(summary.total)}</div></div>
        <div className="stat-card amber clickable" onClick={() => setSf(isProforma ? '' : 'unpaid')}><div className="stat-label">{purchaseMode ? 'To pay' : isProforma ? 'Still to collect' : 'Outstanding'}</div><div className="stat-val amber">{fmt(summary.outstanding)}</div><div className="stat-sub">{purchaseMode ? 'owed to suppliers' : 'after payments, TDS & credit notes'}</div></div>
        <div className="stat-card red clickable" onClick={() => !isProforma && setSf('overdue')}><div className="stat-label">Overdue</div><div className="stat-val red">{fmt(summary.overdue.reduce((s, i) => s + Math.max(0, dueOf(i)), 0))}</div><div className="stat-sub">{summary.overdue.length} past due date</div></div>
        <div className="stat-card purple clickable" onClick={() => !isProforma && setSf('draft')}><div className="stat-label">Drafts</div><div className="stat-val purple">{summary.drafts}</div><div className="stat-sub">{purchaseMode ? 'still booked as payable' : 'not in GSTR-1 until issued'}</div></div>
      </div>

      {/* ── Filter bar ── */}
      <div className="filter-bar">
        <input placeholder={purchaseMode ? 'Search bill #, supplier…' : 'Search number, party…'} value={search} onChange={e => setSearch(e.target.value)} />
        <button
          className={`btn btn-sm ${groupByMonth ? 'btn-primary' : 'btn-ghost'}`}
          title={groupByMonth ? 'Switch to one flat list' : 'Group by month'}
          onClick={handleGroupToggle}
          style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.03em' }}
        >
          {groupByMonth ? '📅 By month' : '≡ All'}
        </button>
        {!purchaseMode && !isProforma && <button className="btn btn-ghost btn-sm" onClick={autoNumber} title="Sort draft invoices by date and give them the next numbers in each FY series">⟳ Auto-number drafts</button>}
        {!purchaseMode && <button className={`btn ${isProforma ? 'btn-primary' : 'btn-ghost btn-sm'}`} onClick={() => { setEditData(null); setShowPF(true); }}>+ Proforma</button>}
        {!isProforma && <button className="btn btn-primary" onClick={() => { setEditData(null); setShowInv(true); }}>{purchaseMode ? '+ Purchase Bill' : '+ Invoice'}</button>}
      </div>
      <div className="chip-row" style={{ marginBottom: 14 }}>
        {statusChips.map(([v, l]) => <button key={v || 'all'} className={`chip${sf === v ? ' active' : ''}`} onClick={() => setSf(v)}>{l}</button>)}
      </div>

      {scoped.length === 0 ? (
        <EmptyState icon={purchaseMode ? '🧾' : isProforma ? '📋' : '📄'} message={`No ${docWord} yet`}
          sub={purchaseMode ? 'Record a supplier bill to track what you owe and your input GST credit.' : isProforma ? 'Raise a proforma to collect an advance before supplying; it becomes a tax invoice once paid.' : 'Click "+ Invoice" to raise your first tax invoice.'} />
      ) : flatList ? renderTable(filtered) : (
        <>
          {/* ── Month tab strip ── */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
            {sortedMonthKeys.map(key => {
              const isActive = shownMonth === key;
              const list = monthGroups[key];
              const total = list.reduce((s, i) => s + Number(i.total), 0);
              return (
                <button key={key} onClick={() => setActiveMonth(key)} className="chip"
                  style={{ borderRadius: 'var(--r)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 74, fontFamily: 'var(--mono)', ...(isActive ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#0d0d0d' } : {}) }}>
                  <span style={{ fontWeight: 600 }}>{fmtMonthKey(key)}</span>
                  <span style={{ fontSize: 10, opacity: 0.8 }}>{list.length} · {fmt(total)}</span>
                </button>
              );
            })}
          </div>
          {shownMonth && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{fmtMonthKey(shownMonth)}</span>
                <MonthSummary list={monthGroups[shownMonth]} />
              </div>
              {renderTable(monthGroups[shownMonth])}
            </div>
          )}
        </>
      )}

      {/* ── Modals ── */}
      {showInv && <InvoiceModal onClose={() => setShowInv(false)} onSave={handleSave} businesses={businesses} parties={parties} editData={editData} allInvoices={invoices} catalogItems={catalogItems} activeBiz={activeBiz} purchaseMode={purchaseMode} />}
      {showPF && <InvoiceModal onClose={() => setShowPF(false)} onSave={handleSave} businesses={businesses} parties={parties} editData={null} allInvoices={invoices} isProforma={true} catalogItems={catalogItems} activeBiz={activeBiz} />}
      {payInv && <PaymentModal onClose={() => setPayInv(null)} onSave={handlePayment} invoice={payInv} existingPayments={paysByInv[payInv.id] || []}
        creditNotes={cnsByInv[payInv.id] || []}
        parties={parties} allPayments={payments} onLinked={(amt, date) => afterPayment(payInv.id, amt, date, { skipStatus: true })} />}
      {cnFor && <CreditNoteModal onClose={() => setCnFor(null)} onSave={saveCN} businesses={businesses} parties={parties} invoices={invoices}
        creditNotes={creditNotes} preInvoice={cnFor.inv} initialItems={cnFor.items} activeBiz={activeBiz} />}
    </>
  );
}
