// opsLink.js — reads the Needle Point operations app's tables (public schema:
// brands, products, product_sizes, shipments, employees, work_logs) from the
// SAME Supabase project and connects them to accounting documents.
// Needs sql/integration/001_link_operations.sql. See MERGE_GUIDE.md.
import { supabase } from './db.js';
import { guessHSN } from './constants.js';

const ops = () => supabase.schema('public');

// Must match accounts_erp.ops_order_key() in the SQL and the operations app.
export function orderKeyOf(product) {
  const po = (product?.po_number || '').trim();
  return po ? `PO:${product.brand_id || 'none'}|${po.toUpperCase()}` : `P:${product.id}`;
}

async function pageAll(build) {
  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return all;
}

// Everything the production screens need, in one go. `ok: false` (with the
// reason) when the operations tables aren't reachable from this project yet.
export async function loadOpsData() {
  try {
    const [brands, products, sizes, shipments, employees, workLogs, settingsRes, linkedItems] = await Promise.all([
      pageAll(() => ops().from('brands').select('*').order('id')),
      pageAll(() => ops().from('products').select('*').order('id')),
      pageAll(() => ops().from('product_sizes').select('*').order('id')),
      pageAll(() => ops().from('shipments').select('*').order('id')),
      pageAll(() => ops().from('employees').select('*').order('id')),
      pageAll(() => ops().from('work_logs').select('id,product_id,employee_id,work_type,quantity,logged_at').order('id')),
      supabase.from('integration_settings').select('*').eq('id', 1).maybeSingle(),
      pageAll(() => supabase.from('invoice_items').select('id,invoice_id,ops_product_id,quantity').not('ops_product_id', 'is', null).order('id')),
    ]);
    if (settingsRes.error) throw settingsRes.error;
    return { ok: true, brands, products, sizes, shipments, employees, workLogs, linkedItems, settings: settingsRes.data || {} };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function setOpsBusiness(businessId) {
  const { data, error } = await supabase.rpc('set_ops_business', { biz: businessId });
  if (error) throw new Error(`Linking failed: ${error.message}`);
  return data;
}

export async function linkShipments(ids, patch) {
  if (!ids?.length) return;
  const { error } = await ops().from('shipments').update(patch).in('id', ids);
  if (error) throw new Error(`Couldn't mark dispatches: ${error.message}`);
}

// ── Orders ─────────────────────────────────────────────────────────────────
// Groups garments into orders the same way the operations app does (same PO
// + brand = one order) and works out quantities: ordered, dispatched, already
// invoiced, and dispatched-but-not-invoiced.
export function buildOrders({ brands, products, sizes, shipments, linkedItems }, { invoices = [], payments = [], challans = [] }) {
  const brandById = Object.fromEntries(brands.map(b => [b.id, b]));
  const sizesBy = group(sizes, 'product_id');
  const shipBy = group(shipments, 'product_id');
  const liveTaxInvoice = new Set(invoices.filter(i => i.type === 'sale' && !['cancelled', 'proforma'].includes(i.status)).map(i => i.id));
  const invoicedQty = {};
  linkedItems.forEach(it => { if (liveTaxInvoice.has(it.invoice_id)) invoicedQty[it.ops_product_id] = (invoicedQty[it.ops_product_id] || 0) + Number(it.quantity || 0); });
  const paysBy = group(payments, 'invoice_id');

  const orders = new Map();
  for (const p of products) {
    const key = orderKeyOf(p);
    if (!orders.has(key)) {
      orders.set(key, { key, po_number: (p.po_number || '').trim().toUpperCase() || null, brand_id: p.brand_id, brand: brandById[p.brand_id] || null, created_at: p.created_at, lines: [] });
    }
    const o = orders.get(key);
    if (p.created_at && (!o.created_at || p.created_at < o.created_at)) o.created_at = p.created_at;
    const psz = sizesBy[p.id] || [];
    const psh = shipBy[p.id] || [];
    const isSample = p.status === 'sampling';
    const ordered = isSample ? 1 : psz.reduce((s, x) => s + Number(x.quantity || 0), 0);
    const dispatched = psh.reduce((s, x) => s + Number(x.quantity || 0), 0);
    const rate = Number(p.price_per_piece || 0);
    const gst = p.gst_rate != null ? Number(p.gst_rate) : 5;
    o.lines.push({
      product: p, sizes: psz, shipments: psh, isSample, ordered, dispatched, rate, gst,
      invoiced: invoicedQty[p.id] || 0,
      uninvoicedShip: psh.filter(x => !x.invoice_id),
      unchallanedShip: psh.filter(x => !x.invoice_id && !x.challan_id),
      value: rate * ordered,
    });
  }

  return [...orders.values()].map(o => {
    const docs = invoices.filter(i => i.ops_order_key === o.key && i.type === 'sale');
    const taxDocs = docs.filter(i => !['cancelled', 'proforma'].includes(i.status));
    const proformas = docs.filter(i => i.status === 'proforma');
    const received = docs.filter(i => i.status !== 'cancelled').reduce((s, i) => s + (paysBy[i.id] || []).reduce((a, p) => a + Number(p.amount || 0), 0), 0);
    const advance = proformas.reduce((s, i) => s + (paysBy[i.id] || []).reduce((a, p) => a + Number(p.amount || 0), 0), 0);
    const value = o.lines.reduce((s, l) => s + l.value, 0);
    const valueInclGst = o.lines.reduce((s, l) => s + l.value * (1 + l.gst / 100), 0);
    const invoicedTotal = taxDocs.reduce((s, i) => s + Number(i.total || 0), 0);
    const ordered = o.lines.reduce((s, l) => s + l.ordered, 0);
    const dispatched = o.lines.reduce((s, l) => s + l.dispatched, 0);
    const invoicedQtyTotal = o.lines.reduce((s, l) => s + Math.min(l.invoiced, Math.max(l.ordered, l.dispatched)), 0);
    const toInvoiceQty = o.lines.reduce((s, l) => s + l.uninvoicedShip.reduce((a, x) => a + Number(x.quantity || 0), 0), 0);
    const remainingQty = o.lines.reduce((s, l) => s + Math.max(0, Math.max(l.ordered, l.dispatched) - l.invoiced), 0);
    const billBase = Math.max(invoicedTotal, Math.round(valueInclGst));
    const balance = billBase - received;
    const status = taxDocs.length === 0
      ? (received > 0 ? 'advance' : proformas.length ? 'proforma' : 'unbilled')
      : remainingQty > 0 ? (balance <= 0.5 ? 'part_invoiced_paid' : 'part_invoiced')
      : balance <= 0.5 ? 'paid' : 'invoiced';
    return {
      ...o, docs, taxDocs, proformas, challans: challans.filter(c => c.ops_order_key === o.key),
      value, valueInclGst, invoicedTotal, received, advance, balance, ordered, dispatched,
      invoicedQty: invoicedQtyTotal, toInvoiceQty, remainingQty, status,
    };
  }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function group(rows, key) {
  const m = {};
  rows.forEach(r => { (m[r[key]] ||= []).push(r); });
  return m;
}

const sizeText = rows => {
  const m = {};
  rows.forEach(r => { const k = r.size_label || 'Mixed'; m[k] = (m[k] || 0) + Number(r.quantity || 0); });
  return Object.entries(m).filter(([, q]) => q > 0).map(([k, q]) => `${k}:${q}`).join(', ');
};

function lineFor(l, quantity, sizesNote) {
  const p = l.product;
  const name = `${p.name}${p.style_code ? ` (${p.style_code})` : ''}${sizesNote ? ` — ${sizesNote}` : ''}`;
  const hsn = guessHSN(p.name)?.hsn || '';
  return {
    description: name, hsn_code: hsn, hsn_auto: !!hsn, hsn_guess_label: hsn ? guessHSN(p.name).label : null,
    quantity, unit_price: l.rate, discount_percent: 0, tax_percent: l.gst,
    unit: 'Nos', ops_product_id: p.id,
  };
}

// Invoice/proforma lines for the whole order (proforma), or for what is still
// left to invoice (final invoice).
export function linesForOrder(order, { remainingOnly = false } = {}) {
  return order.lines.map(l => {
    const qty = remainingOnly ? Math.max(0, Math.max(l.ordered, l.dispatched) - l.invoiced) : l.ordered;
    if (qty <= 0) return null;
    return lineFor(l, qty, l.isSample ? 'sample' : (!remainingOnly ? sizeText(l.sizes) : ''));
  }).filter(Boolean);
}

// Lines for dispatched pieces not yet on an invoice (or not yet on a challan).
export function linesForDispatches(order, { forChallan = false } = {}) {
  const shipIds = [];
  const lines = order.lines.map(l => {
    const rows = forChallan ? l.unchallanedShip : l.uninvoicedShip;
    const qty = rows.reduce((s, x) => s + Number(x.quantity || 0), 0);
    if (qty <= 0) return null;
    rows.forEach(r => shipIds.push(r.id));
    return lineFor(l, qty, sizeText(rows));
  }).filter(Boolean);
  return { lines, shipIds };
}

// ── Advances ───────────────────────────────────────────────────────────────
// Moves advance received on an order's proforma onto a tax invoice, so the
// invoice shows as paid and the proforma no longer looks like money owed.
// Whole payments are re-pointed; a payment bigger than what's needed is split
// in two — and its journal entry split the same way, so Payments, the journal
// and Tally keep agreeing. Payments tied to a bank statement row are only
// moved whole (splitting them would break the bank link amounts).
export async function applyAdvance({ proformaPayments, toInvoiceId, amountNeeded, proformaNumber }) {
  let remaining = Math.round(Number(amountNeeded) * 100) / 100;
  let moved = 0;
  const sorted = [...proformaPayments].sort((a, b) => (a.payment_date || '').localeCompare(b.payment_date || ''));
  for (const p of sorted) {
    if (remaining <= 0.005) break;
    const amt = Number(p.amount);
    const note = `Advance adjusted from ${proformaNumber}`;
    if (amt <= remaining + 0.005) {
      const { error } = await supabase.from('payments').update({ invoice_id: toInvoiceId, notes: p.notes ? `${p.notes} · ${note}` : note }).eq('id', p.id);
      if (error) throw new Error(`Moving advance failed: ${error.message}`);
      moved += amt; remaining -= amt;
      continue;
    }
    const { data: links } = await supabase.from('bank_txn_links').select('id').eq('payment_id', p.id).limit(1);
    if (links?.length) continue;
    const part = Math.round(remaining * 100) / 100;
    const keep = Math.round((amt - part) * 100) / 100;
    const { data: je } = await supabase.from('journal_entries').select('*').eq('source', 'payment').eq('source_id', p.id).maybeSingle();
    const { id: _id, created_at: _c, ...copy } = p;
    const { data: newPay, error: e1 } = await supabase.from('payments').insert({ ...copy, amount: part, invoice_id: toInvoiceId, notes: note }).select().single();
    if (e1) throw new Error(`Splitting advance failed: ${e1.message}`);
    const { error: e2 } = await supabase.from('payments').update({ amount: keep }).eq('id', p.id);
    if (e2) throw new Error(`Splitting advance failed: ${e2.message}`);
    if (je) {
      const { data: lines } = await supabase.from('journal_lines').select('*').eq('journal_id', je.id);
      for (const ln of lines || []) await supabase.from('journal_lines').update({ amount: keep }).eq('id', ln.id);
      const { id: _j, created_at: _jc, ...jeCopy } = je;
      const { data: newJe, error: e3 } = await supabase.from('journal_entries').insert({ ...jeCopy, source_id: newPay.id, narration: note }).select().single();
      if (!e3 && newJe) {
        await supabase.from('journal_lines').insert((lines || []).map(({ id: _l, created_at: _lc, ...ln }) => ({ ...ln, journal_id: newJe.id, amount: part })));
      }
    }
    moved += part; remaining -= part;
  }
  return moved;
}

// ── Costing ────────────────────────────────────────────────────────────────
// Labour cost per piece for each employee and month: monthly salary ÷ pieces
// they logged that month. Logs without a quantity can't be costed.
export function labourRates(employees, workLogs) {
  const salary = Object.fromEntries(employees.map(e => [e.id, Number(e.monthly_salary || 0)]));
  const pieces = {};
  workLogs.forEach(w => {
    if (!w.employee_id || !w.quantity) return;
    const k = `${w.employee_id}|${monthOf(w.logged_at)}`;
    pieces[k] = (pieces[k] || 0) + Number(w.quantity);
  });
  const rate = {};
  Object.entries(pieces).forEach(([k, n]) => { const s = salary[k.split('|')[0]]; if (s && n) rate[k] = s / n; });
  return rate;
}
export function monthOf(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
