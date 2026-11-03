// views/Items.jsx — Item / Product Master
import { useState } from 'react';
import { fmt, GST_RATES } from '../lib/constants.js';
import { saveItem, deleteItem } from '../lib/db.js';
import { Badge, ModalShell, FG, EmptyState } from '../components/ui.jsx';

export function ItemsView({ items, businesses, activeBiz, reload }) {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editData, setEditData] = useState(null);

  const filtered = items.filter(it => {
    const bizMatch = activeBiz ? it.business_id === activeBiz : true;
    const q = search.toLowerCase();
    return bizMatch && (!q ||
      it.name.toLowerCase().includes(q) ||
      (it.hsn_code || '').toLowerCase().includes(q) ||
      (it.category || '').toLowerCase().includes(q) ||
      (it.brand || '').toLowerCase().includes(q)
    );
  }).sort((a, b) => (a.brand || '~').localeCompare(b.brand || '~') || a.name.localeCompare(b.name));

  const brands = [...new Set(items.filter(it => !activeBiz || it.business_id === activeBiz).map(it => (it.brand || '').trim()).filter(Boolean))].sort();

  async function save(data, id) {
    await saveItem({ ...data, business_id: activeBiz || businesses[0]?.id }, id);
    reload();
  }

  async function del(id) {
    if (!confirm('Delete this item?')) return;
    await deleteItem(id);
    reload();
  }

  return (
    <>
      <div className="filter-bar">
        <input placeholder="Search brand, name, HSN, category…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={() => { setEditData(null); setShowModal(true); }}>+ Add Item</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Brand</th>
              <th>Name</th>
              <th>Category</th>
              <th>HSN / SAC</th>
              <th>Unit</th>
              <th className="r">Sale Price</th>
              <th className="r">GST %</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(it => (
              <tr key={it.id}>
                <td style={{ fontSize: 11, color: 'var(--accent)' }}>{it.brand || '—'}</td>
                <td style={{ fontWeight: 600 }}>{it.name}</td>
                <td style={{ fontSize: 11, color: 'var(--text2)' }}>{it.category || '—'}</td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{it.hsn_code || '—'}</td>
                <td style={{ fontSize: 11 }}>{it.unit || 'Pcs'}</td>
                <td className="r mono" style={{ fontWeight: 600 }}>{fmt(it.sale_price || 0)}</td>
                <td className="r mono" style={{ fontSize: 11 }}>
                  <span className="gst-chip igst" style={{ fontSize: 9 }}>{it.tax_percent || 0}%</span>
                </td>
                <td style={{ fontSize: 11, color: 'var(--text3)', maxWidth: 200 }}>{it.description || '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditData(it); setShowModal(true); }}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => del(it.id)}>Del</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9}>
                <EmptyState icon="📦" message="No items yet"
                  sub="Add products per brand here (same product, different brand = separate entry with its own price). Pick them from the 📦 list on invoice lines." />
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <ItemModal
          onClose={() => setShowModal(false)}
          onSave={save}
          editData={editData}
          businesses={businesses}
          activeBiz={activeBiz}
          brands={brands}
        />
      )}
    </>
  );
}

function ItemModal({ onClose, onSave, editData, businesses, activeBiz, brands = [] }) {
  const [f, setF] = useState({
    brand: editData?.brand || '',
    name: editData?.name || '',
    category: editData?.category || '',
    hsn_code: editData?.hsn_code || '',
    unit: editData?.unit || 'Pcs',
    sale_price: editData?.sale_price || '',
    purchase_price: editData?.purchase_price || '',
    tax_percent: editData?.tax_percent ?? 5,
    description: editData?.description || '',
    business_id: activeBiz || editData?.business_id || businesses[0]?.id || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const UNITS = ['Pcs', 'Nos', 'Kg', 'Gm', 'Mtr', 'Cm', 'Ltr', 'Box', 'Set', 'Pair', 'Roll', 'Sheet', 'Bag', 'Other'];
  const CATS = ['Fabric', 'Garments', 'Accessories', 'Raw Material', 'Finished Goods', 'Services', 'Packaging', 'Other'];

  async function save() {
    if (!f.name.trim()) { setErr('Name is required'); return; }
    setErr(''); setBusy(true);
    try {
      await onSave({ ...f, sale_price: Number(f.sale_price) || 0, purchase_price: Number(f.purchase_price) || 0, tax_percent: Number(f.tax_percent) }, editData?.id);
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell
      title={editData ? 'Edit Item' : 'Add Item'}
      onClose={onClose}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>}
    >
      <div className="form-row cols-2">
        <FG label="Brand / Client">
          <input list="item-brands" value={f.brand} onChange={e => setF(x => ({ ...x, brand: e.target.value }))} placeholder="e.g. Cayani (leave blank if generic)" />
          <datalist id="item-brands">{brands.map(b => <option key={b} value={b} />)}</datalist>
        </FG>
        <FG label="Item Name *">
          <input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="e.g. Sketch Top" />
        </FG>
      </div>
      <div className="form-row cols-2">
        <FG label="Category">
          <select value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))}>
            <option value="">Select…</option>
            {CATS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FG>
        <div />
      </div>

      <div className="form-row cols-3">
        <FG label="HSN / SAC Code">
          <input value={f.hsn_code} onChange={e => setF(x => ({ ...x, hsn_code: e.target.value }))} placeholder="e.g. 62061010" style={{ fontFamily: 'var(--mono)' }} />
        </FG>
        <FG label="Unit of Measure">
          <select value={f.unit} onChange={e => setF(x => ({ ...x, unit: e.target.value }))}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </FG>
        <FG label="GST %">
          <select value={f.tax_percent} onChange={e => setF(x => ({ ...x, tax_percent: e.target.value }))}>
            {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </FG>
      </div>

      <div className="form-row cols-2">
        <FG label="Sale Price (₹)">
          <input type="number" min="0" value={f.sale_price} onChange={e => setF(x => ({ ...x, sale_price: e.target.value }))} placeholder="0.00" />
        </FG>
        <FG label="Purchase Price (₹)">
          <input type="number" min="0" value={f.purchase_price} onChange={e => setF(x => ({ ...x, purchase_price: e.target.value }))} placeholder="0.00" />
        </FG>
      </div>

      <FG label="Description">
        <textarea value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} placeholder="Optional notes about this item" />
      </FG>

      {err && <p className="err-msg">{err}</p>}
    </ModalShell>
  );
}
