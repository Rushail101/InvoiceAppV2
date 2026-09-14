import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/db.js';
import { Badge, FG } from '../components/ui.jsx';

const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const monthNow = () => new Date().toISOString().slice(0, 7);
const bizFilter = (q, activeBiz) => activeBiz ? q.eq('business_id', activeBiz) : q;
const clean = v => String(v ?? '').trim();
const num = v => Number(String(v ?? 0).replace(/,/g, '')) || 0;

function Shell({ title, subtitle, actions, children }) {
  return <div>
    <div className="page-head" style={{ marginBottom: 18 }}>
      <div><h3 style={{ margin: 0 }}>{title}</h3>{subtitle && <p style={{ margin: '5px 0 0', color: 'var(--text3)', fontSize: 12 }}>{subtitle}</p>}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</div>
    </div>
    {children}
  </div>;
}

function Table({ headers, rows, empty = 'No records yet.' }) {
  return <div className="card" style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr>{headers.map(h => <th key={h} style={{ padding: '9px 10px', textAlign: 'left', color: 'var(--text3)', borderBottom: '1px solid var(--border1)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
      <tbody>{rows.length ? rows : <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>{empty}</td></tr>}</tbody>
    </table>
  </div>;
}

function Modal({ title, onClose, children, onSave, saveLabel = 'Save' }) {
  return <div className="modal-backdrop"><div className="modal" style={{ maxWidth: 760 }}>
    <div className="modal-head"><strong>{title}</strong><button className="btn btn-ghost btn-sm" onClick={onClose}>×</button></div>
    <div className="modal-body">{children}</div>
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={onSave}>{saveLabel}</button></div>
  </div></div>;
}

// Handles the quoted commas used by GST portal exports. This intentionally stays
// local: no API or external parser is required.
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => clean(x) !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(x => clean(x) !== '')) rows.push(row);
  return rows;
}

function colIndex(headers, ...names) {
  return headers.findIndex(h => names.some(n => h.includes(n)));
}

export function GSTR2BView({ activeBiz, invoices = [], parties = [], reload }) {
  const [rows, setRows] = useState([]);
  const [file, setFile] = useState(null);
  const [period, setPeriod] = useState(monthNow());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!supabase) return;
    let q = supabase.from('gst_2b_records').select('*').order('invoice_date', { ascending: false });
    q = bizFilter(q, activeBiz);
    const { data, error } = await q;
    if (error) setMsg(error.message); else setRows(data || []);
  }
  useEffect(() => { load(); }, [activeBiz]);

  const purchases = invoices.filter(i => (!activeBiz || i.business_id === activeBiz) && i.type === 'purchase');
  const matched = rows.map(r => {
    const rGST = clean(r.supplier_gstin).toLowerCase();
    const rNo = clean(r.invoice_number).toLowerCase();
    const exact = purchases.find(x => clean(x.invoice_number).toLowerCase() === rNo && clean(parties.find(y => y.id === x.party_id)?.gstin).toLowerCase() === rGST);
    const byNo = purchases.find(x => clean(x.invoice_number).toLowerCase() === rNo);
    const p = exact || byNo;
    const amount = num(r.total_tax);
    const book = num(p?.tax_amount);
    const delta = amount - book;
    const status = !p ? 'Missing in Books' : Math.abs(delta) < 1 ? 'Matched' : 'Tax Mismatch';
    return { ...r, p, delta, status };
  });

  async function saveRecon(row) {
    const payload = {
      business_id: activeBiz,
      gst_2b_id: row.id,
      invoice_id: row.p?.id || null,
      status: row.status === 'Matched' ? 'matched' : row.status === 'Tax Mismatch' ? 'mismatch' : 'missing_in_books',
      difference: row.delta,
      reviewed: true,
      reviewed_at: new Date().toISOString(),
    };
    const { data: existing, error: findError } = await supabase.from('gst_reconciliation').select('id').eq('gst_2b_id', row.id).limit(1).maybeSingle();
    if (findError) { setMsg(findError.message); return; }
    const result = existing
      ? await supabase.from('gst_reconciliation').update(payload).eq('id', existing.id)
      : await supabase.from('gst_reconciliation').insert(payload);
    if (result.error) setMsg(result.error.message); else setMsg(`Reconciliation saved for ${row.invoice_number}`);
  }

  async function importCsv() {
    if (!file || !activeBiz) { setMsg('Select a business and a GST 2B CSV first.'); return; }
    setBusy(true); setMsg('');
    try {
      const rowsCSV = parseCSV(await file.text());
      if (rowsCSV.length < 2) throw new Error('CSV contains no data rows.');
      const headers = rowsCSV[0].map(x => clean(x).toLowerCase());
      const ix = {
        gstin: colIndex(headers, 'gstin', 'supplier gstin'),
        supplier: colIndex(headers, 'supplier name', 'supplier'),
        invoice: colIndex(headers, 'invoice number', 'invoice no', 'invoice'),
        date: colIndex(headers, 'invoice date'),
        taxable: colIndex(headers, 'taxable value', 'taxable'),
        igst: colIndex(headers, 'igst'),
        cgst: colIndex(headers, 'cgst'),
        sgst: colIndex(headers, 'sgst'),
        cess: colIndex(headers, 'cess'),
        tax: colIndex(headers, 'total tax', 'tax amount', 'tax'),
      };
      if (ix.gstin < 0 || ix.invoice < 0) throw new Error('Could not find Supplier GSTIN / Invoice Number columns in the CSV.');
      const out = rowsCSV.slice(1).map(c => {
        const igst = num(c[ix.igst]), cgst = num(c[ix.cgst]), sgst = num(c[ix.sgst]), cess = num(c[ix.cess]);
        const suppliedTax = ix.tax >= 0 ? num(c[ix.tax]) : igst + cgst + sgst + cess;
        return {
          business_id: activeBiz,
          gstr2b_period: period,
          supplier_gstin: clean(c[ix.gstin]),
          supplier_name: ix.supplier >= 0 ? clean(c[ix.supplier]) : '',
          invoice_number: clean(c[ix.invoice]),
          invoice_date: ix.date >= 0 ? clean(c[ix.date]) || null : null,
          taxable_value: ix.taxable >= 0 ? num(c[ix.taxable]) : 0,
          igst, cgst, sgst, cess,
          total_tax: suppliedTax,
          match_status: 'unmatched',
        };
      }).filter(x => x.supplier_gstin && x.invoice_number);
      if (!out.length) throw new Error('No valid 2B rows found.');
      const { error } = await supabase.from('gst_2b_records').upsert(out, { onConflict: 'business_id,gstr2b_period,supplier_gstin,invoice_number' });
      if (error) throw error;
      await load();
      setMsg(`Imported ${out.length} GSTR-2B records. Review mismatches below.`);
      reload?.();
    } catch (e) { setMsg(e.message || 'Import failed.'); }
    finally { setBusy(false); }
  }

  return <Shell title="GSTR-2B Reconciliation" subtitle="Import the GST portal 2B CSV and match supplier bills deterministically — no API required."
    actions={<><input type="month" value={period} onChange={e => setPeriod(e.target.value)} /><input type="file" accept=".csv" onChange={e => setFile(e.target.files?.[0] || null)} /><button className="btn btn-primary" onClick={importCsv} disabled={busy}>{busy ? 'Importing…' : 'Import & Match'}</button></>}>
    {msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}
    <div className="grid-4" style={{ marginBottom: 18 }}>{[['2B Records', rows.length], ['Matched', matched.filter(x => x.status === 'Matched').length], ['Missing', matched.filter(x => x.status === 'Missing in Books').length], ['Mismatch', matched.filter(x => x.status === 'Tax Mismatch').length]].map(([a, b]) => <div className="metric card" key={a}><span>{a}</span><strong>{b}</strong></div>)}</div>
    <Table headers={['Supplier GSTIN', 'Invoice', 'Date', '2B Tax', 'Books Tax', 'Difference', 'Status', 'Action']} rows={matched.map(r => <tr key={r.id}>
      <td style={{ padding: 9, fontFamily: 'var(--mono)' }}>{r.supplier_gstin}</td><td style={{ padding: 9 }}>{r.invoice_number}</td><td style={{ padding: 9 }}>{r.invoice_date || '—'}</td><td style={{ padding: 9 }}>{money(r.total_tax)}</td><td style={{ padding: 9 }}>{money(r.p?.tax_amount)}</td><td style={{ padding: 9 }}>{money(r.delta)}</td><td style={{ padding: 9 }}><Badge>{r.status}</Badge></td><td style={{ padding: 9 }}><button className="btn btn-ghost btn-sm" onClick={() => saveRecon(r)}>Review</button></td>
    </tr>)} />
  </Shell>;
}

export function GSTR3BView({ activeBiz, invoices = [], creditNotes = [], reload }) {
  const [period, setPeriod] = useState(monthNow());
  const [msg, setMsg] = useState('');
  const sales = useMemo(() => invoices.filter(i => (!activeBiz || i.business_id === activeBiz) && i.type !== 'purchase' && i.status !== 'cancelled'), [invoices, activeBiz]);
  const purchases = useMemo(() => invoices.filter(i => (!activeBiz || i.business_id === activeBiz) && i.type === 'purchase' && i.status !== 'cancelled'), [invoices, activeBiz]);
  const start = period + '-01';
  const end = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).toISOString().slice(0, 10);
  const inPeriod = d => d >= start && d <= end;
  const s = sales.filter(x => inPeriod(x.issue_date));
  const p = purchases.filter(x => inPeriod(x.issue_date));
  const cn = creditNotes.filter(x => (!activeBiz || x.business_id === activeBiz) && inPeriod(x.cn_date));
  const output = { taxable: s.reduce((a, x) => a + num(x.subtotal), 0), cgst: s.reduce((a, x) => a + num(x.cgst_amount), 0), sgst: s.reduce((a, x) => a + num(x.sgst_amount), 0), igst: s.reduce((a, x) => a + num(x.igst_amount), 0) };
  const cnOut = { cgst: cn.reduce((a, x) => a + num(x.cgst_amount), 0), sgst: cn.reduce((a, x) => a + num(x.sgst_amount), 0), igst: cn.reduce((a, x) => a + num(x.igst_amount), 0) };
  const itcRows = p.filter(x => x.itc_eligible !== false);
  const itc = { cgst: itcRows.reduce((a, x) => a + num(x.cgst_amount), 0), sgst: itcRows.reduce((a, x) => a + num(x.sgst_amount), 0), igst: itcRows.reduce((a, x) => a + num(x.igst_amount), 0) };
  const outputTax = output.cgst + output.sgst + output.igst;
  const creditTax = cnOut.cgst + cnOut.sgst + cnOut.igst;
  const eligibleITC = itc.cgst + itc.sgst + itc.igst;
  const netTax = Math.max(0, outputTax - creditTax);
  const payable = Math.max(0, netTax - eligibleITC);

  async function saveSnapshot() {
    if (!activeBiz) { setMsg('Select a business first.'); return; }
    const payload = { business_id: activeBiz, return_type: 'GSTR-3B', period, status: 'review', payload: { outward: output, credit_notes: cnOut, itc, output_tax: outputTax, credit_tax: creditTax, eligible_itc: eligibleITC, net_tax: netTax, payable } };
    const { error } = await supabase.from('gst_return_snapshots').upsert(payload, { onConflict: 'business_id,return_type,period' });
    setMsg(error ? error.message : `GSTR-3B ${period} snapshot saved for review.`); reload?.();
  }

  return <Shell title="GSTR-3B" subtitle="Book-based review summary. Save a snapshot before filing on the GST portal." actions={<><input type="month" value={period} onChange={e => setPeriod(e.target.value)} /><button className="btn btn-primary" onClick={saveSnapshot}>Save Review Snapshot</button></>}>
    {msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}
    <div className="grid-4" style={{ marginBottom: 18 }}>{[['Taxable Sales', output.taxable], ['Output GST', netTax], ['Eligible ITC', eligibleITC], ['Net GST Payable', payable]].map(([a, b]) => <div className="metric card" key={a}><span>{a}</span><strong>{money(b)}</strong></div>)}</div>
    <div className="grid-2"><div className="card"><div className="card-head">Outward Supplies</div><Table headers={['Component', 'Amount']} rows={[[['Taxable', output.taxable], ['CGST', output.cgst - cnOut.cgst], ['SGST', output.sgst - cnOut.sgst], ['IGST', output.igst - cnOut.igst], ['Credit Notes GST', creditTax]].map(([a, b]) => <tr key={a}><td style={{ padding: 9 }}>{a}</td><td style={{ padding: 9 }}>{money(b)}</td></tr>)].flat()} /></div>
      <div className="card"><div className="card-head">Input Tax Credit</div><Table headers={['Component', 'Amount']} rows={[[['CGST', itc.cgst], ['SGST', itc.sgst], ['IGST', itc.igst], ['Total eligible ITC', eligibleITC]].map(([a, b]) => <tr key={a}><td style={{ padding: 9 }}>{a}</td><td style={{ padding: 9 }}>{money(b)}</td></tr>)].flat()} /></div></div>
  </Shell>;
}

export function InventoryView({ activeBiz, items = [], reload }) {
  const [rows, setRows] = useState([]); const [warehouses, setWarehouses] = useState([]); const [show, setShow] = useState(false); const [msg, setMsg] = useState('');
  const [f, setF] = useState({ item_id: '', warehouse_id: '', quantity: 0, unit_cost: 0, movement_type: 'receipt', reference: '' });
  async function load() {
    let q = supabase.from('stock_ledger').select('*').order('movement_date', { ascending: false }); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []);
    let w = supabase.from('warehouses').select('*').order('name'); w = bizFilter(w, activeBiz); const r = await w; setWarehouses(r.data || []);
  }
  useEffect(() => { load(); }, [activeBiz]);
  const balances = {};
  rows.forEach(r => { const k = `${r.item_id}|${r.warehouse_id}`; balances[k] = (balances[k] || 0) + (['issue', 'transfer_out'].includes(r.movement_type) ? -num(r.quantity) : num(r.quantity)); });
  async function save() {
    const qty = num(f.quantity); if (!activeBiz || !f.item_id || !f.warehouse_id || qty <= 0) { setMsg('Select item, warehouse and a quantity greater than zero.'); return; }
    const current = balances[`${f.item_id}|${f.warehouse_id}`] || 0;
    if (['issue', 'transfer_out'].includes(f.movement_type) && qty > current + 0.0001) { setMsg(`Insufficient stock. Available: ${current}`); return; }
    const { error } = await supabase.from('stock_ledger').insert({ ...f, business_id: activeBiz, quantity: qty, unit_cost: num(f.unit_cost), movement_date: today() });
    if (error) setMsg(error.message); else { setMsg('Stock movement recorded.'); setShow(false); setF({ item_id: '', warehouse_id: '', quantity: 0, unit_cost: 0, movement_type: 'receipt', reference: '' }); load(); reload?.(); }
  }
  const totalUnits = Object.values(balances).reduce((a, x) => a + x, 0);
  return <Shell title="Inventory & Stock" subtitle="Rule-based stock ledger with warehouse balances." actions={<button className="btn btn-primary" onClick={() => setShow(true)}>+ Stock Movement</button>}>
    {msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}
    <div className="grid-4" style={{ marginBottom: 18 }}>{[['Movements', rows.length], ['Items', new Set(rows.map(r => r.item_id)).size], ['Warehouses', warehouses.length], ['Net Units', totalUnits]].map(([a, b]) => <div className="metric card" key={a}><span>{a}</span><strong>{b}</strong></div>)}</div>
    {show && <Modal title="Stock Movement" onClose={() => setShow(false)} onSave={save}><div className="form-row cols-2"><FG label="Item"><select value={f.item_id} onChange={e => setF({ ...f, item_id: e.target.value })}><option value="">Select…</option>{items.filter(i => !activeBiz || i.business_id === activeBiz).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></FG><FG label="Warehouse"><select value={f.warehouse_id} onChange={e => setF({ ...f, warehouse_id: e.target.value })}><option value="">Select…</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></FG></div><div className="form-row cols-3"><FG label="Movement"><select value={f.movement_type} onChange={e => setF({ ...f, movement_type: e.target.value })}><option value="receipt">Receipt</option><option value="issue">Issue</option><option value="adjustment">Adjustment</option><option value="transfer_in">Transfer In</option><option value="transfer_out">Transfer Out</option></select></FG><FG label="Quantity"><input type="number" min="0" value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} /></FG><FG label="Unit Cost"><input type="number" min="0" value={f.unit_cost} onChange={e => setF({ ...f, unit_cost: e.target.value })} /></FG></div><FG label="Reference"><input value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></FG></Modal>}
    <Table headers={['Date', 'Item', 'Warehouse', 'Movement', 'Qty', 'Unit Cost', 'Reference', 'Balance']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{r.movement_date}</td><td style={{ padding: 9 }}>{items.find(i => i.id === r.item_id)?.name || '—'}</td><td style={{ padding: 9 }}>{warehouses.find(w => w.id === r.warehouse_id)?.name || '—'}</td><td style={{ padding: 9 }}><Badge>{r.movement_type}</Badge></td><td style={{ padding: 9 }}>{r.quantity}</td><td style={{ padding: 9 }}>{money(r.unit_cost)}</td><td style={{ padding: 9 }}>{r.reference || '—'}</td><td style={{ padding: 9 }}>{balances[`${r.item_id}|${r.warehouse_id}`] ?? 0}</td></tr>)} />
  </Shell>;
}

export function WarehousesView({ activeBiz, reload }) {
  const [rows, setRows] = useState([]); const [f, setF] = useState({ name: '', code: '', address: '' }); const [msg, setMsg] = useState('');
  async function load() { let q = supabase.from('warehouses').select('*').order('name'); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []); }
  useEffect(() => { load(); }, [activeBiz]);
  async function add() { if (!activeBiz || !clean(f.name)) { setMsg('Warehouse name is required.'); return; } const { error } = await supabase.from('warehouses').insert({ ...f, business_id: activeBiz }); if (error) setMsg(error.message); else { setF({ name: '', code: '', address: '' }); load(); reload?.(); } }
  return <Shell title="Warehouses" subtitle="Locations used by inventory and production.">{msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}<div className="card" style={{ marginBottom: 14 }}><div className="form-row cols-3"><FG label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></FG><FG label="Code"><input value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} /></FG><FG label="Address"><input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></FG></div><button className="btn btn-primary" onClick={add}>Add Warehouse</button></div><Table headers={['Name', 'Code', 'Address', 'Status']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{r.name}</td><td style={{ padding: 9, fontFamily: 'var(--mono)' }}>{r.code || '—'}</td><td style={{ padding: 9 }}>{r.address || '—'}</td><td style={{ padding: 9 }}><Badge>{r.active === false ? 'inactive' : 'active'}</Badge></td></tr>)} /></Shell>;
}

export function OrdersView({ activeBiz, parties = [], items = [], type = 'sales', reload }) {
  const [rows, setRows] = useState([]); const [show, setShow] = useState(false); const [msg, setMsg] = useState('');
  const [f, setF] = useState({ party_id: '', number: '', date: today(), status: 'draft', item_id: '', quantity: 1, unit_price: 0, tax_percent: 0 });
  const label = type === 'sales' ? 'Sales Orders' : 'Purchase Orders'; const table = type === 'sales' ? 'sales_orders' : 'purchase_orders'; const child = type === 'sales' ? 'sales_order_items' : 'purchase_order_items'; const childKey = type === 'sales' ? 'sales_order_id' : 'purchase_order_id';
  async function load() { let q = supabase.from(table).select('*').order('order_date', { ascending: false }); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []); }
  useEffect(() => { load(); }, [activeBiz]);
  async function save() {
    if (!activeBiz || !f.party_id || !clean(f.number) || !f.item_id || num(f.quantity) <= 0) { setMsg('Party, order number, item and quantity are required.'); return; }
    const amount = num(f.quantity) * num(f.unit_price); const tax = amount * num(f.tax_percent) / 100;
    const { data: o, error } = await supabase.from(table).insert({ business_id: activeBiz, party_id: f.party_id, order_number: f.number, order_date: f.date, status: f.status, subtotal: amount, tax_amount: tax, total: amount + tax }).select().single();
    if (error) { setMsg(error.message); return; }
    const { error: ie } = await supabase.from(child).insert({ [childKey]: o.id, item_id: f.item_id, description: items.find(i => i.id === f.item_id)?.name || '', quantity: num(f.quantity), unit_price: num(f.unit_price), tax_percent: num(f.tax_percent), taxable_amount: amount, amount: amount + tax });
    if (ie) setMsg(ie.message); else { setShow(false); load(); reload?.(); }
  }
  return <Shell title={label} subtitle="Structured workflow before billing." actions={<button className="btn btn-primary" onClick={() => setShow(true)}>+ New {type === 'sales' ? 'Sales' : 'Purchase'} Order</button>}>
    {msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}
    {show && <Modal title={`New ${type === 'sales' ? 'Sales' : 'Purchase'} Order`} onClose={() => setShow(false)} onSave={save}><div className="form-row cols-2"><FG label={type === 'sales' ? 'Customer' : 'Supplier'}><select value={f.party_id} onChange={e => setF({ ...f, party_id: e.target.value })}><option value="">Select…</option>{parties.filter(p => !activeBiz || p.business_id === activeBiz).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FG><FG label="Order #"><input value={f.number} onChange={e => setF({ ...f, number: e.target.value })} /></FG></div><div className="form-row cols-4"><FG label="Date"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></FG><FG label="Item"><select value={f.item_id} onChange={e => setF({ ...f, item_id: e.target.value })}><option value="">Select…</option>{items.filter(i => !activeBiz || i.business_id === activeBiz).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></FG><FG label="Qty"><input type="number" min="0" value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} /></FG><FG label="Unit Price"><input type="number" min="0" value={f.unit_price} onChange={e => setF({ ...f, unit_price: e.target.value })} /></FG></div><FG label="GST %"><input type="number" min="0" value={f.tax_percent} onChange={e => setF({ ...f, tax_percent: e.target.value })} /></FG></Modal>}
    <Table headers={['Order #', 'Date', 'Party', 'Status', 'Total']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9, fontFamily: 'var(--mono)' }}>{r.order_number}</td><td style={{ padding: 9 }}>{r.order_date}</td><td style={{ padding: 9 }}>{parties.find(p => p.id === r.party_id)?.name || '—'}</td><td style={{ padding: 9 }}><Badge>{r.status}</Badge></td><td style={{ padding: 9 }}>{money(r.total)}</td></tr>)} />
  </Shell>;
}

export function QuotationsView({ activeBiz, parties = [], items = [], reload }) {
  const [rows, setRows] = useState([]); const [show, setShow] = useState(false); const [msg, setMsg] = useState(''); const [f, setF] = useState({ party_id: '', number: '', date: today(), valid_until: '', item_id: '', quantity: 1, unit_price: 0, tax_percent: 0 });
  async function load() { let q = supabase.from('quotations').select('*').order('quotation_date', { ascending: false }); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []); }
  useEffect(() => { load(); }, [activeBiz]);
  async function save() { if (!activeBiz || !f.party_id || !clean(f.number) || !f.item_id) { setMsg('Customer, quotation number and item are required.'); return; } const subtotal = num(f.quantity) * num(f.unit_price); const tax = subtotal * num(f.tax_percent) / 100; const { data: q, error } = await supabase.from('quotations').insert({ business_id: activeBiz, party_id: f.party_id, quotation_number: f.number, quotation_date: f.date, valid_until: f.valid_until || null, status: 'draft', subtotal, tax_amount: tax, total: subtotal + tax }).select().single(); if (error) { setMsg(error.message); return; } const { error: ie } = await supabase.from('quotation_items').insert({ quotation_id: q.id, item_id: f.item_id, description: items.find(i => i.id === f.item_id)?.name || '', quantity: num(f.quantity), unit_price: num(f.unit_price), tax_percent: num(f.tax_percent), taxable_amount: subtotal, amount: subtotal + tax }); if (ie) setMsg(ie.message); else { setShow(false); load(); reload?.(); } }
  async function convert(id) { const q = rows.find(x => x.id === id); if (!q) return; const { data: line } = await supabase.from('quotation_items').select('*').eq('quotation_id', id).limit(1).maybeSingle(); const { data: so, error } = await supabase.from('sales_orders').insert({ business_id: q.business_id, party_id: q.party_id, order_number: `SO-${q.quotation_number}`, order_date: today(), status: 'draft', subtotal: q.subtotal, tax_amount: q.tax_amount, total: q.total, notes: `Converted from quotation ${q.quotation_number}` }).select().single(); if (error) { setMsg(error.message); return; } if (line) await supabase.from('sales_order_items').insert({ sales_order_id: so.id, item_id: line.item_id, description: line.description, quantity: line.quantity, unit_price: line.unit_price, tax_percent: line.tax_percent, taxable_amount: line.taxable_amount, amount: line.amount }); await supabase.from('quotations').update({ status: 'accepted' }).eq('id', id); setMsg(`Quotation ${q.quotation_number} converted to ${so.order_number}.`); load(); reload?.(); }
  return <Shell title="Quotations" subtitle="Quote first, then convert an approved quote into a sales order." actions={<button className="btn btn-primary" onClick={() => setShow(true)}>+ New Quotation</button>}>{msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}{show && <Modal title="New Quotation" onClose={() => setShow(false)} onSave={save}><div className="form-row cols-2"><FG label="Customer"><select value={f.party_id} onChange={e => setF({ ...f, party_id: e.target.value })}><option value="">Select…</option>{parties.filter(p => !activeBiz || p.business_id === activeBiz).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FG><FG label="Quotation #"><input value={f.number} onChange={e => setF({ ...f, number: e.target.value })} /></FG></div><div className="form-row cols-4"><FG label="Date"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></FG><FG label="Valid Until"><input type="date" value={f.valid_until} onChange={e => setF({ ...f, valid_until: e.target.value })} /></FG><FG label="Item"><select value={f.item_id} onChange={e => setF({ ...f, item_id: e.target.value })}><option value="">Select…</option>{items.filter(i => !activeBiz || i.business_id === activeBiz).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></FG><FG label="Qty"><input type="number" min="0" value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} /></FG></div><div className="form-row cols-2"><FG label="Unit Price"><input type="number" min="0" value={f.unit_price} onChange={e => setF({ ...f, unit_price: e.target.value })} /></FG><FG label="GST %"><input type="number" min="0" value={f.tax_percent} onChange={e => setF({ ...f, tax_percent: e.target.value })} /></FG></div></Modal>}<Table headers={['Quotation #', 'Date', 'Customer', 'Valid Until', 'Status', 'Total', 'Action']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{r.quotation_number}</td><td style={{ padding: 9 }}>{r.quotation_date}</td><td style={{ padding: 9 }}>{parties.find(p => p.id === r.party_id)?.name || '—'}</td><td style={{ padding: 9 }}>{r.valid_until || '—'}</td><td style={{ padding: 9 }}><Badge>{r.status}</Badge></td><td style={{ padding: 9 }}>{money(r.total)}</td><td style={{ padding: 9 }}>{r.status !== 'accepted' && <button className="btn btn-ghost btn-sm" onClick={() => convert(r.id)}>→ Sales Order</button>}</td></tr>)} /></Shell>;
}

export function GRNView({ activeBiz, parties = [], items = [], reload }) {
  const [rows, setRows] = useState([]); const [warehouses, setWarehouses] = useState([]); const [show, setShow] = useState(false); const [msg, setMsg] = useState(''); const [f, setF] = useState({ number: '', date: today(), supplier_id: '', po_ref: '', item_id: '', quantity: 1, warehouse_id: '', unit_cost: 0 });
  async function load() { let q = supabase.from('grns').select('*').order('receipt_date', { ascending: false }); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []); let w = supabase.from('warehouses').select('*').order('name'); w = bizFilter(w, activeBiz); const wr = await w; setWarehouses(wr.data || []); }
  useEffect(() => { load(); }, [activeBiz]);
  async function save() {
    if (!activeBiz || !clean(f.number) || !f.item_id || !f.warehouse_id || num(f.quantity) <= 0) { setMsg('GRN number, item, warehouse and quantity are required.'); return; }
    const { data: g, error } = await supabase.from('grns').insert({ business_id: activeBiz, grn_number: f.number, receipt_date: f.date, supplier_id: f.supplier_id || null, po_ref: f.po_ref || null, status: 'received' }).select().single();
    if (error) { setMsg(error.message); return; }
    const { error: ie } = await supabase.from('grn_items').insert({ grn_id: g.id, item_id: f.item_id, quantity: num(f.quantity), warehouse_id: f.warehouse_id });
    if (ie) { setMsg(ie.message); return; }
    const { error: se } = await supabase.from('stock_ledger').insert({ business_id: activeBiz, item_id: f.item_id, warehouse_id: f.warehouse_id, movement_date: f.date, movement_type: 'receipt', quantity: num(f.quantity), unit_cost: num(f.unit_cost), reference: f.number, source_type: 'grn', source_id: g.id });
    if (se) setMsg(`GRN saved, but stock posting failed: ${se.message}`); else { setShow(false); setMsg(`GRN ${f.number} recorded and stock received.`); setF({ number: '', date: today(), supplier_id: '', po_ref: '', item_id: '', quantity: 1, warehouse_id: '', unit_cost: 0 }); load(); reload?.(); }
  }
  return <Shell title="GRN / Goods Receipt" subtitle="Record physical receipt before the supplier bill; received quantities post into stock." actions={<button className="btn btn-primary" onClick={() => setShow(true)}>+ New GRN</button>}>{msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}{show && <Modal title="New GRN" onClose={() => setShow(false)} onSave={save}><div className="form-row cols-4"><FG label="GRN #"><input value={f.number} onChange={e => setF({ ...f, number: e.target.value })} /></FG><FG label="Date"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></FG><FG label="Supplier"><select value={f.supplier_id} onChange={e => setF({ ...f, supplier_id: e.target.value })}><option value="">Select…</option>{parties.filter(p => !activeBiz || p.business_id === activeBiz).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FG><FG label="PO Ref"><input value={f.po_ref} onChange={e => setF({ ...f, po_ref: e.target.value })} /></FG></div><div className="form-row cols-4"><FG label="Item"><select value={f.item_id} onChange={e => setF({ ...f, item_id: e.target.value })}><option value="">Select…</option>{items.filter(i => !activeBiz || i.business_id === activeBiz).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></FG><FG label="Qty"><input type="number" min="0" value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} /></FG><FG label="Warehouse"><select value={f.warehouse_id} onChange={e => setF({ ...f, warehouse_id: e.target.value })}><option value="">Select…</option>{warehouses.filter(w => !activeBiz || w.business_id === activeBiz).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></FG><FG label="Unit Cost"><input type="number" min="0" value={f.unit_cost} onChange={e => setF({ ...f, unit_cost: e.target.value })} /></FG></div></Modal>}<Table headers={['GRN #', 'Date', 'Supplier', 'PO Ref', 'Status']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{r.grn_number}</td><td style={{ padding: 9 }}>{r.receipt_date}</td><td style={{ padding: 9 }}>{parties.find(p => p.id === r.supplier_id)?.name || '—'}</td><td style={{ padding: 9 }}>{r.po_ref || '—'}</td><td style={{ padding: 9 }}><Badge>{r.status}</Badge></td></tr>)} /></Shell>;
}

export function AuditTrailView({ activeBiz }) { const [rows, setRows] = useState([]); const [msg, setMsg] = useState(''); useEffect(() => { (async () => { let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []); })(); }, [activeBiz]); return <Shell title="Audit Trail" subtitle="Immutable operational history for key accounting and document changes.">{msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}<Table headers={['Time', 'User', 'Action', 'Table', 'Record', 'Summary']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{new Date(r.created_at).toLocaleString('en-IN')}</td><td style={{ padding: 9 }}>{r.user_email || 'System'}</td><td style={{ padding: 9 }}><Badge>{r.action}</Badge></td><td style={{ padding: 9 }}>{r.table_name}</td><td style={{ padding: 9, fontFamily: 'var(--mono)' }}>{String(r.record_id || '').slice(0, 8)}</td><td style={{ padding: 9 }}>{r.summary || '—'}</td></tr>)} /></Shell>; }

export function UsersRolesView({ activeBiz, businesses = [] }) { const [rows, setRows] = useState([]); const [email, setEmail] = useState(''); const [role, setRole] = useState('staff'); const [msg, setMsg] = useState(''); async function load() { let q = supabase.from('user_business_roles').select('*').order('created_at', { ascending: false }); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []); } useEffect(() => { load(); }, [activeBiz]); async function add() { if (!email || !activeBiz) return; const { error } = await supabase.from('user_business_roles').insert({ business_id: activeBiz, user_email: email.trim().toLowerCase(), role }); if (error) setMsg(error.message); else { setEmail(''); load(); } } return <Shell title="Users & Roles" subtitle="Business-scoped roles ready for Supabase Auth/RLS.">{msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}<div className="card" style={{ marginBottom: 14 }}><div className="form-row cols-3"><FG label="User email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></FG><FG label="Role"><select value={role} onChange={e => setRole(e.target.value)}><option>owner</option><option>admin</option><option>accountant</option><option>staff</option><option>viewer</option></select></FG><div style={{ display: 'flex', alignItems: 'end' }}><button className="btn btn-primary" onClick={add}>Add Access</button></div></div></div><Table headers={['Email', 'Role', 'Business']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{r.user_email}</td><td style={{ padding: 9 }}><Badge>{r.role}</Badge></td><td style={{ padding: 9 }}>{businesses.find(b => b.id === r.business_id)?.name || '—'}</td></tr>)}/></Shell>; }

export function ProductionView({ activeBiz, items = [], reload }) {
  const [rows, setRows] = useState([]); const [materials, setMaterials] = useState([]); const [warehouses, setWarehouses] = useState([]); const [msg, setMsg] = useState(''); const [f, setF] = useState({ number: '', item_id: '', qty: 1, status: 'planned' });
  async function load() { let q = supabase.from('production_orders').select('*').order('created_at', { ascending: false }); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []); let m = supabase.from('production_materials').select('*'); const mr = await m; setMaterials(mr.data || []); let w = supabase.from('warehouses').select('*').order('name'); w = bizFilter(w, activeBiz); const wr = await w; setWarehouses(wr.data || []); }
  useEffect(() => { load(); }, [activeBiz]);
  async function add() { if (!activeBiz || !clean(f.number) || !f.item_id || num(f.qty) <= 0) { setMsg('Production number, finished item and quantity are required.'); return; } const { error } = await supabase.from('production_orders').insert({ business_id: activeBiz, production_number: f.number, finished_item_id: f.item_id, planned_quantity: num(f.qty), status: f.status }); if (error) setMsg(error.message); else { setF({ number: '', item_id: '', qty: 1, status: 'planned' }); load(); reload?.(); } }
  async function issueMaterial(order) { const itemId = window.prompt('Material item UUID (use Item Master id):'); const qty = num(window.prompt('Quantity to issue:')); const warehouseId = window.prompt('Warehouse UUID:'); if (!itemId || !warehouseId || qty <= 0) return; const { error: me } = await supabase.from('production_materials').insert({ production_order_id: order.id, item_id: itemId, planned_quantity: qty, issued_quantity: qty, unit_cost: 0 }); if (me) { setMsg(me.message); return; } const { error: se } = await supabase.from('stock_ledger').insert({ business_id: activeBiz, item_id: itemId, warehouse_id: warehouseId, movement_date: today(), movement_type: 'issue', quantity: qty, unit_cost: 0, reference: order.production_number, source_type: 'production', source_id: order.id }); if (se) setMsg(se.message); else { setMsg(`Issued ${qty} units to ${order.production_number}.`); load(); reload?.(); } }
  return <Shell title="Production" subtitle="Production orders with material issue tracking and stock consumption." actions={<button className="btn btn-primary" onClick={add}>Create Production Order</button>}><div className="card" style={{ marginBottom: 14 }}><div className="form-row cols-4"><FG label="Production #"><input value={f.number} onChange={e => setF({ ...f, number: e.target.value })} /></FG><FG label="Finished Item"><select value={f.item_id} onChange={e => setF({ ...f, item_id: e.target.value })}><option value="">Select…</option>{items.filter(i => !activeBiz || i.business_id === activeBiz).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></FG><FG label="Quantity"><input type="number" min="0" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></FG><FG label="Status"><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option>planned</option><option>in_progress</option><option>qc</option><option>completed</option><option>cancelled</option></select></FG></div></div>{msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}<Table headers={['Production #', 'Finished Item', 'Planned Qty', 'Issued Materials', 'Status', 'Action']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{r.production_number}</td><td style={{ padding: 9 }}>{items.find(i => i.id === r.finished_item_id)?.name || '—'}</td><td style={{ padding: 9 }}>{r.planned_quantity}</td><td style={{ padding: 9 }}>{materials.filter(m => m.production_order_id === r.id).reduce((a, m) => a + num(m.issued_quantity), 0)}</td><td style={{ padding: 9 }}><Badge>{r.status}</Badge></td><td style={{ padding: 9 }}><button className="btn btn-ghost btn-sm" onClick={() => issueMaterial(r)}>Issue Material</button></td></tr>)}/><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Material issue uses deterministic stock-ledger entries. For a production BOM, add planned components to production materials before issue.</div></Shell>;
}

export function CostCentresView({ activeBiz, reload }) {
  const [rows, setRows] = useState([]); const [projects, setProjects] = useState([]); const [f, setF] = useState({ name: '', code: '', type: 'department' }); const [p, setP] = useState({ name: '', code: '', budget: 0, status: 'active' }); const [msg, setMsg] = useState('');
  async function load() { let q = supabase.from('cost_centres').select('*').order('name'); q = bizFilter(q, activeBiz); const r = await q; setRows(r.data || []); let x = supabase.from('projects').select('*').order('name'); x = bizFilter(x, activeBiz); const pr = await x; setProjects(pr.data || []); }
  useEffect(() => { load(); }, [activeBiz]);
  async function addCC() { if (!activeBiz || !clean(f.name)) return; const { error } = await supabase.from('cost_centres').insert({ ...f, business_id: activeBiz }); if (error) setMsg(error.message); else { setF({ name: '', code: '', type: 'department' }); load(); reload?.(); } }
  async function addProject() { if (!activeBiz || !clean(p.name)) return; const { error } = await supabase.from('projects').insert({ ...p, business_id: activeBiz, budget: num(p.budget) }); if (error) setMsg(error.message); else { setP({ name: '', code: '', budget: 0, status: 'active' }); load(); reload?.(); } }
  return <Shell title="Cost Centres & Projects" subtitle="Structure factory, brand, department and project profitability without external services.">{msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}<div className="grid-2"><div className="card"><div className="card-head">Cost Centre</div><div className="form-row cols-3"><FG label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></FG><FG label="Code"><input value={f.code} onChange={e => setF({ ...f, code: e.target.value })} /></FG><FG label="Type"><select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option>department</option><option>project</option><option>brand</option><option>factory</option></select></FG></div><button className="btn btn-primary" onClick={addCC}>Add Cost Centre</button></div><div className="card"><div className="card-head">Project</div><div className="form-row cols-4"><FG label="Name"><input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></FG><FG label="Code"><input value={p.code} onChange={e => setP({ ...p, code: e.target.value })} /></FG><FG label="Budget"><input type="number" min="0" value={p.budget} onChange={e => setP({ ...p, budget: e.target.value })} /></FG><FG label="Status"><select value={p.status} onChange={e => setP({ ...p, status: e.target.value })}><option>active</option><option>on_hold</option><option>completed</option><option>cancelled</option></select></FG></div><button className="btn btn-primary" onClick={addProject}>Add Project</button></div></div><div style={{ marginTop: 18 }}><Table headers={['Cost Centre', 'Code', 'Type']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{r.name}</td><td style={{ padding: 9 }}>{r.code || '—'}</td><td style={{ padding: 9 }}><Badge>{r.type}</Badge></td></tr>)} /></div><div style={{ marginTop: 18 }}><Table headers={['Project', 'Code', 'Budget', 'Status']} rows={projects.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{r.name}</td><td style={{ padding: 9 }}>{r.code || '—'}</td><td style={{ padding: 9 }}>{money(r.budget)}</td><td style={{ padding: 9 }}><Badge>{r.status}</Badge></td></tr>)} /></div></Shell>;
}

export function GSTAmendmentsView({ activeBiz, invoices = [], reload }) {
  const [rows, setRows] = useState([]); const [f, setF] = useState({ source_invoice_id: '', period: monthNow(), section: 'B2B', reason: '' }); const [msg, setMsg] = useState('');
  async function load() { let q = supabase.from('gst_amendments').select('*').order('created_at', { ascending: false }); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []); }
  useEffect(() => { load(); }, [activeBiz]);
  async function save() { if (!activeBiz || !f.source_invoice_id || !clean(f.reason)) { setMsg('Select a source invoice and enter the amendment reason.'); return; } const inv = invoices.find(i => i.id === f.source_invoice_id); const payload = { business_id: activeBiz, return_type: 'GSTR-1A', period: f.period, source_invoice_id: f.source_invoice_id, section: f.section, old_value: inv || {}, new_value: inv || {}, status: 'draft' }; const { error } = await supabase.from('gst_amendments').insert(payload); if (error) setMsg(error.message); else { setMsg('Amendment staged for review.'); setF({ source_invoice_id: '', period: monthNow(), section: 'B2B', reason: '' }); load(); reload?.(); } }
  return <Shell title="GST Amendments / GSTR-1A" subtitle="Stage corrections for human review before filing. The ERP never silently changes a filed document.">{msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}<div className="card" style={{ marginBottom: 14 }}><div className="form-row cols-4"><FG label="Invoice"><select value={f.source_invoice_id} onChange={e => setF({ ...f, source_invoice_id: e.target.value })}><option value="">Select…</option>{invoices.filter(i => (!activeBiz || i.business_id === activeBiz) && i.type !== 'purchase').map(i => <option key={i.id} value={i.id}>{i.invoice_number}</option>)}</select></FG><FG label="Period"><input type="month" value={f.period} onChange={e => setF({ ...f, period: e.target.value })} /></FG><FG label="Section"><select value={f.section} onChange={e => setF({ ...f, section: e.target.value })}><option>B2B</option><option>B2C</option><option>Export</option><option>CDNR</option><option>HSN</option></select></FG><FG label="Reason"><input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></FG></div><button className="btn btn-primary" onClick={save}>Stage Amendment</button></div><Table headers={['Period', 'Section', 'Source Invoice', 'Status', 'Created']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{r.period}</td><td style={{ padding: 9 }}>{r.section || '—'}</td><td style={{ padding: 9 }}>{invoices.find(i => i.id === r.source_invoice_id)?.invoice_number || r.source_invoice_id || '—'}</td><td style={{ padding: 9 }}><Badge>{r.status}</Badge></td><td style={{ padding: 9 }}>{new Date(r.created_at).toLocaleDateString('en-IN')}</td></tr>)} /></Shell>;
}

export function AutomationExceptionsView({ activeBiz, reload }) {
  const [rows, setRows] = useState([]); const [msg, setMsg] = useState('');
  async function load() { let q = supabase.from('automation_exceptions').select('*').order('created_at', { ascending: false }); q = bizFilter(q, activeBiz); const { data, error } = await q; if (error) setMsg(error.message); else setRows(data || []); }
  useEffect(() => { load(); }, [activeBiz]);
  async function resolve(id) { const { error } = await supabase.from('automation_exceptions').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id); if (error) setMsg(error.message); else { load(); reload?.(); } }
  const open = rows.filter(r => r.status === 'open');
  return <Shell title="Automation Exceptions" subtitle="The ERP automates routine work and surfaces only the items that need human judgement.">{msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}<div className="grid-4" style={{ marginBottom: 18 }}>{[['Open', open.length], ['High', open.filter(r => r.severity === 'high').length], ['Medium', open.filter(r => r.severity === 'medium').length], ['Resolved', rows.filter(r => r.status === 'resolved').length]].map(([a, b]) => <div className="metric card" key={a}><span>{a}</span><strong>{b}</strong></div>)}</div><Table headers={['Created', 'Severity', 'Type', 'Message', 'Status', 'Action']} rows={rows.map(r => <tr key={r.id}><td style={{ padding: 9 }}>{new Date(r.created_at).toLocaleString('en-IN')}</td><td style={{ padding: 9 }}><Badge>{r.severity}</Badge></td><td style={{ padding: 9 }}>{r.exception_type}</td><td style={{ padding: 9 }}>{r.message}</td><td style={{ padding: 9 }}><Badge>{r.status}</Badge></td><td style={{ padding: 9 }}>{r.status === 'open' && <button className="btn btn-ghost btn-sm" onClick={() => resolve(r.id)}>Resolve</button>}</td></tr>)} /></Shell>;
}

export function KPIDashboard({ activeBiz, invoices = [], expenses = [], payments = [], parties = [] }) {
  const inv = invoices.filter(i => !activeBiz || i.business_id === activeBiz); const exp = expenses.filter(i => !activeBiz || i.business_id === activeBiz); const pay = payments.filter(i => !activeBiz || i.business_id === activeBiz);
  const sales = inv.filter(i => i.type !== 'purchase' && i.status !== 'cancelled').reduce((a, x) => a + num(x.total), 0); const purchases = inv.filter(i => i.type === 'purchase' && i.status !== 'cancelled').reduce((a, x) => a + num(x.total), 0);
  const receivable = inv.filter(i => i.type !== 'purchase' && !['cancelled', 'proforma'].includes(i.status)).reduce((a, x) => a + Math.max(0, num(x.total) - pay.filter(p => p.invoice_id === x.id).reduce((s, p) => s + num(p.amount), 0)), 0);
  const payable = inv.filter(i => i.type === 'purchase' && !['cancelled', 'proforma'].includes(i.status)).reduce((a, x) => a + Math.max(0, num(x.total) - pay.filter(p => p.invoice_id === x.id).reduce((s, p) => s + num(p.amount), 0)), 0);
  return <Shell title="Management Dashboard" subtitle="Exception-first KPIs across sales, purchases and working capital."><div className="grid-4">{[['Revenue', sales], ['Purchases', purchases], ['Receivables', receivable], ['Payables', payable]].map(([a, b]) => <div className="metric card" key={a}><span>{a}</span><strong>{money(b)}</strong></div>)}</div><div className="grid-2" style={{ marginTop: 18 }}><div className="card"><div className="card-head">Operational Signals</div><div style={{ display: 'grid', gap: 10, fontSize: 13 }}><div>👥 Active parties <strong>{parties.filter(p => !activeBiz || p.business_id === activeBiz).length}</strong></div><div>🧾 Open sales invoices <strong>{inv.filter(i => !['paid', 'cancelled', 'proforma'].includes(i.status) && i.type !== 'purchase').length}</strong></div><div>💸 Expenses <strong>{money(exp.reduce((a, x) => a + num(x.amount), 0))}</strong></div><div>💳 Payments recorded <strong>{money(pay.reduce((a, x) => a + num(x.amount), 0))}</strong></div></div></div><div className="card"><div className="card-head">Automation Philosophy</div><p style={{ color: 'var(--text2)', lineHeight: 1.7, fontSize: 13 }}>Enter once → post once → reconcile automatically → review exceptions. GST calculations, matching, numbering and workflow rules remain deterministic; no paid AI/API is required.</p></div></div></Shell>;
}
