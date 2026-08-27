import { useState } from 'react';
import {
  fmt, fmtDate, today, getFY, GST_RATES, INDIAN_STATES, gstType, calcLineTax,
} from '../lib/constants.js';
import {
  saveChallan, getChallanItems, deleteChallan,
} from '../lib/db.js';
import { printChallan } from '../lib/pdf.js';
import { Badge, ModalShell, FG, EmptyState } from '../components/ui.jsx';

// ─── NUMBERING ─────────────────────────────────────────────────────────────────
function nextChallanNum(challans) {
  const fy = getFY();
  const pat = new RegExp(`^DC-${fy}/(\\d+)$`);
  let max = 0;
  challans.forEach(c => {
    const m = (c.challan_number || '').match(pat);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `DC-${fy}/${String(max + 1).padStart(3, '0')}`;
}

// ─── LINE ITEM CALCULATION ─────────────────────────────────────────────────────
function calcItem(it, isIntrastate) {
  const base = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  const discAmt = base * (Number(it.discount_percent || 0) / 100);
  const taxable = base - discAmt;
  const { cgst, sgst, igst } = calcLineTax(taxable, Number(it.tax_percent || 0), isIntrastate);
  const lineTotal = taxable + cgst + sgst + igst;
  return { ...it, base, discAmt, taxable, cgst, sgst, igst, lineTotal };
}

const PURPOSES = ['Supply of Goods', 'Job Work', 'Loan / Exhibition', 'Return of Goods', 'Others'];
const TRANSPORT_MODES = ['Road', 'Rail', 'Air', 'Ship / Waterways'];

// ─── CHALLAN MODAL ─────────────────────────────────────────────────────────────
function ChallanModal({ onClose, onSave, businesses, parties, allChallans, invoices, editData, activeBiz }) {
  const [f, setF] = useState({
    business_id: editData?.business_id || activeBiz || businesses[0]?.id || '',
    party_id: editData?.party_id || '',
    challan_number: editData?.challan_number || nextChallanNum(allChallans),
    challan_date: editData?.challan_date || today(),
    purpose: editData?.purpose || 'Supply of Goods',
    vehicle_number: editData?.vehicle_number || '',
    transport_mode: editData?.transport_mode || 'Road',
    lr_number: editData?.lr_number || '',
    driver_name: editData?.driver_name || '',
    dispatch_from: editData?.dispatch_from || '',
    dispatch_to: editData?.dispatch_to || '',
    linked_invoice_id: editData?.linked_invoice_id || '',
    notes: editData?.notes || '',
    status: editData?.status || 'draft',
  });

  const [items, setItems] = useState(
    editData?.items?.length
      ? editData.items
      : [{ description: '', hsn_code: '', quantity: 1, unit: 'Nos', unit_price: 0, discount_percent: 0, tax_percent: 5 }]
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bizObj = businesses.find(b => b.id === f.business_id) || {};
  const partyObj = parties.find(p => p.id === f.party_id) || {};
  const isIntrastate = gstType(bizObj.state, partyObj.state) === 'intrastate';
  const filteredParties = parties.filter(p => p.business_id === f.business_id);
  const filteredInvoices = invoices.filter(inv => inv.business_id === f.business_id && inv.party_id === f.party_id);

  const calc = items.map(it => calcItem(it, isIntrastate));
  const subtotal = calc.reduce((s, i) => s + i.taxable, 0);
  const totalCGST = calc.reduce((s, i) => s + i.cgst, 0);
  const totalSGST = calc.reduce((s, i) => s + i.sgst, 0);
  const totalIGST = calc.reduce((s, i) => s + i.igst, 0);
  const grand = subtotal + totalCGST + totalSGST + totalIGST;

  function upd(idx, field, val) {
    setItems(prev => prev.map((it, i) => i !== idx ? it : { ...it, [field]: val }));
  }
  function addRow() {
    setItems(p => [...p, { description: '', hsn_code: '', quantity: 1, unit: 'Nos', unit_price: 0, discount_percent: 0, tax_percent: 5 }]);
  }
  function remRow(idx) { setItems(p => p.filter((_, i) => i !== idx)); }

  async function save() {
    if (!f.party_id) { setErr('Select a party'); return; }
    const validItems = calc.filter(i => i.description?.trim());
    if (!validItems.length) { setErr('Add at least one line item'); return; }
    setErr(''); setBusy(true);
    try {
      const challanData = {
        ...f,
        subtotal,
        cgst_amount: totalCGST,
        sgst_amount: totalSGST,
        igst_amount: totalIGST,
        tax_amount: totalCGST + totalSGST + totalIGST,
        total: grand,
        is_interstate: !isIntrastate,
      };
      await onSave(challanData, validItems, editData?.id);
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const gstLabel = isIntrastate
    ? <span>GST split: <span className="gst-chip cgst">CGST</span> <span className="gst-chip sgst">SGST</span></span>
    : <span>GST type: <span className="gst-chip igst">IGST</span> (inter-state)</span>;

  return (
    <ModalShell
      title={editData ? `Edit Challan — ${editData.challan_number}` : 'New Delivery Challan'}
      onClose={onClose} size="modal-xl"
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save Challan'}
          </button>
        </>
      }
    >
      {/* ── Header ── */}
      <div className="form-row cols-3">
        <FG label="Business">
          <select value={f.business_id} onChange={e => setF(p => ({ ...p, business_id: e.target.value }))}>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FG>
        <FG label="Challan Number">
          <input value={f.challan_number} onChange={e => setF(p => ({ ...p, challan_number: e.target.value }))} />
        </FG>
        <FG label="Date">
          <input type="date" value={f.challan_date} onChange={e => setF(p => ({ ...p, challan_date: e.target.value }))} />
        </FG>
      </div>

      <div className="form-row cols-2">
        <FG label="Party (Consignee)">
          <select value={f.party_id} onChange={e => setF(p => ({ ...p, party_id: e.target.value, linked_invoice_id: '' }))}>
            <option value="">— select party —</option>
            {filteredParties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FG>
        <FG label="Purpose">
          <select value={f.purpose} onChange={e => setF(p => ({ ...p, purpose: e.target.value }))}>
            {PURPOSES.map(pu => <option key={pu} value={pu}>{pu}</option>)}
          </select>
        </FG>
      </div>

      {/* ── Transport Details ── */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Transport Details
        </div>
        <div className="form-row cols-3">
          <FG label="Mode of Transport">
            <select value={f.transport_mode} onChange={e => setF(p => ({ ...p, transport_mode: e.target.value }))}>
              {TRANSPORT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </FG>
          <FG label="Vehicle Number">
            <input placeholder="e.g. DL 01 AB 1234" value={f.vehicle_number}
              onChange={e => setF(p => ({ ...p, vehicle_number: e.target.value.toUpperCase() }))} />
          </FG>
          <FG label="LR / GR Number">
            <input placeholder="Lorry receipt no." value={f.lr_number}
              onChange={e => setF(p => ({ ...p, lr_number: e.target.value }))} />
          </FG>
        </div>
        <div className="form-row cols-3">
          <FG label="Driver Name">
            <input value={f.driver_name} onChange={e => setF(p => ({ ...p, driver_name: e.target.value }))} />
          </FG>
          <FG label="Dispatched From">
            <input placeholder="City / Place" value={f.dispatch_from}
              onChange={e => setF(p => ({ ...p, dispatch_from: e.target.value }))} />
          </FG>
          <FG label="Dispatch To">
            <input placeholder="City / Place" value={f.dispatch_to}
              onChange={e => setF(p => ({ ...p, dispatch_to: e.target.value }))} />
          </FG>
        </div>
      </div>

      {/* ── Link Invoice ── */}
      <div className="form-row cols-2">
        <FG label="Link to Invoice (optional)">
          <select value={f.linked_invoice_id} onChange={e => setF(p => ({ ...p, linked_invoice_id: e.target.value }))}>
            <option value="">— none —</option>
            {filteredInvoices.map(inv => (
              <option key={inv.id} value={inv.id}>{inv.invoice_number} — {fmtDate(inv.issue_date)}</option>
            ))}
          </select>
        </FG>
        <FG label="Status">
          <select value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value }))}>
            <option value="draft">Draft</option>
            <option value="dispatched">Dispatched</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </FG>
      </div>

      {/* ── Line Items ── */}
      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Items &nbsp; {gstLabel}
        </div>
        <table className="inv-table">
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Description</th>
              <th style={{ width: '9%' }}>HSN</th>
              <th style={{ width: '7%' }}>Unit</th>
              <th style={{ width: '8%' }}>Qty</th>
              <th style={{ width: '11%' }}>Rate</th>
              <th style={{ width: '7%' }}>Disc%</th>
              <th style={{ width: '8%' }}>GST%</th>
              <th style={{ width: '12%' }}>Amount</th>
              <th style={{ width: '4%' }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const c = calc[idx];
              return (
                <tr key={idx}>
                  <td>
                    <input className="cell-input" value={it.description}
                      onChange={e => upd(idx, 'description', e.target.value)} placeholder="Item description" />
                  </td>
                  <td>
                    <input className="cell-input" value={it.hsn_code || ''}
                      onChange={e => upd(idx, 'hsn_code', e.target.value)} placeholder="HSN" />
                  </td>
                  <td>
                    <input className="cell-input" value={it.unit || 'Nos'}
                      onChange={e => upd(idx, 'unit', e.target.value)} placeholder="Nos" />
                  </td>
                  <td>
                    <input className="cell-input r" type="number" min="0" value={it.quantity}
                      onChange={e => upd(idx, 'quantity', e.target.value)} />
                  </td>
                  <td>
                    <input className="cell-input r" type="number" min="0" step="0.01" value={it.unit_price}
                      onChange={e => upd(idx, 'unit_price', e.target.value)} />
                  </td>
                  <td>
                    <input className="cell-input r" type="number" min="0" max="100" value={it.discount_percent || 0}
                      onChange={e => upd(idx, 'discount_percent', e.target.value)} />
                  </td>
                  <td>
                    <select className="cell-select" value={it.tax_percent}
                      onChange={e => upd(idx, 'tax_percent', e.target.value)}>
                      {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  </td>
                  <td className="r">{fmt(c.lineTotal)}</td>
                  <td>
                    <button className="del-row" onClick={() => remRow(idx)} title="Remove">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={addRow}>+ Add Row</button>
      </div>

      {/* ── Totals ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <div style={{ minWidth: 280, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--text3)' }}>Taxable Value</span>
            <span>{fmt(subtotal)}</span>
          </div>
          {isIntrastate ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text3)' }}>CGST</span><span>{fmt(totalCGST)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text3)' }}>SGST</span><span>{fmt(totalSGST)}</span>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text3)' }}>IGST</span><span>{fmt(totalIGST)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
            <span>Total</span><span>{fmt(grand)}</span>
          </div>
        </div>
      </div>

      <FG label="Notes">
        <textarea rows={2} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))}
          placeholder="Any delivery instructions or remarks…" />
      </FG>

      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}

// ─── STATUS BADGE ──────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  draft: 'gray',
  dispatched: 'blue',
  delivered: 'green',
  cancelled: 'red',
};

// ─── MAIN VIEW ─────────────────────────────────────────────────────────────────
export function DeliveryChallansView({ challans, parties, businesses, invoices, activeBiz, reload }) {
  const [modal, setModal] = useState(null);  // null | 'new' | challan_obj
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [busy, setBusy] = useState(false);

  // NOTE: activeBiz is passed down as the business's string id (or '' for
  // "All Businesses"), same as every other view — this was doing `.id` on
  // it as if it were a business object, which is always undefined for a
  // string, so no challan ever matched regardless of which business was
  // selected. Also add the "All Businesses" fallback other views have.
  const bizChallans = activeBiz ? challans.filter(c => c.business_id === activeBiz) : challans;

  const filtered = bizChallans.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    const party = parties.find(p => p.id === c.party_id);
    return (
      (c.challan_number || '').toLowerCase().includes(q) ||
      (party?.name || '').toLowerCase().includes(q) ||
      (c.vehicle_number || '').toLowerCase().includes(q) ||
      (c.purpose || '').toLowerCase().includes(q)
    );
  });

  async function handleSave(challanData, items, id) {
    await saveChallan(challanData, items, id);
    reload();
  }

  async function handleDelete(c) {
    if (!confirm(`Delete challan ${c.challan_number}? This cannot be undone.`)) return;
    setBusy(true);
    await deleteChallan(c.id);
    reload();
    setBusy(false);
  }

  async function handlePrint(c) {
    const items = await getChallanItems(c.id);
    const party = parties.find(p => p.id === c.party_id) || {};
    const biz = businesses.find(b => b.id === c.business_id) || {};
    const linkedInv = invoices.find(inv => inv.id === c.linked_invoice_id) || null;
    printChallan(c, items, party, biz, linkedInv);
  }

  async function openEdit(c) {
    const items = await getChallanItems(c.id);
    setModal({ ...c, items });
  }

  return (
    <div className="view-wrap">
      {/* ── Toolbar ── */}
      <div className="view-toolbar">
        <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
          <input
            className="search-input"
            placeholder="Search challan no., party, vehicle…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="dispatched">Dispatched</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => setModal('new')}>+ New Challan</button>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <EmptyState icon="🚚" title="No delivery challans yet" sub="Create your first delivery challan to get started." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Challan No.</th>
                <th>Date</th>
                <th>Party</th>
                <th>Purpose</th>
                <th>Vehicle</th>
                <th>Amount</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const party = parties.find(p => p.id === c.party_id);
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{c.challan_number}</td>
                    <td>{fmtDate(c.challan_date)}</td>
                    <td>{party?.name || <span style={{ color: 'var(--text4)' }}>—</span>}</td>
                    <td style={{ fontSize: 12 }}>{c.purpose}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.vehicle_number || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(c.total)}</td>
                    <td>
                      <Badge color={STATUS_COLORS[c.status] || 'gray'}>
                        {c.status?.charAt(0).toUpperCase() + c.status?.slice(1)}
                      </Badge>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => handlePrint(c)} title="Print">🖨</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)} title="Edit">✏️</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}
                          onClick={() => handleDelete(c)} title="Delete" disabled={busy}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Summary Cards ── */}
      {bizChallans.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          {['draft', 'dispatched', 'delivered', 'cancelled'].map(st => {
            const count = bizChallans.filter(c => c.status === st).length;
            const val = bizChallans.filter(c => c.status === st).reduce((s, c) => s + Number(c.total || 0), 0);
            if (!count) return null;
            return (
              <div key={st} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', minWidth: 140 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'capitalize', marginBottom: 4 }}>{st}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{count}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{fmt(val)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal ── */}
      {modal && (
        <ChallanModal
          onClose={() => setModal(null)}
          onSave={handleSave}
          businesses={businesses}
          parties={parties}
          allChallans={challans}
          invoices={invoices}
          editData={modal === 'new' ? null : modal}
          activeBiz={activeBiz}
        />
      )}
    </div>
  );
}
