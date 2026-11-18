// Production Orders + Payroll — the bridge to the Needle Point operations app.
// Orders, garments, dispatches and staff come from the operations tables in the
// same Supabase project (see MERGE_GUIDE.md / sql/integration/001).
import { useState, useEffect, useMemo, useCallback } from 'react';
import { fmt, fmtDate, today, localISO, nextInvNum, monthEnd, thisMonthKey, invoiceDue } from '../lib/constants.js';
import { saveInvoice, saveChallan, updateInvoice, updateInvoiceStatus, saveExpenseWithJournal, supabase } from '../lib/db.js';
import { loadOpsData, setOpsBusiness, buildOrders, linesForOrder, linesForDispatches, linkShipments, applyAdvance, labourRates, monthOf, logCost, pieceRateFor } from '../lib/opsLink.js';
import { ModalShell, EmptyState, StatCard, toast } from '../components/ui.jsx';
import { useBrandLinks, BrandLinksModal, unlinkedBrandCount } from '../components/BrandLinks.jsx';
import { InvoiceModal } from './Invoices.jsx';
import { ChallanModal } from './DeliveryChallans.jsx';

const STATUS = {
  unbilled:           { label: 'Not billed',         color: 'var(--text3)' },
  proforma:           { label: 'Proforma sent',      color: 'var(--purple)' },
  advance:            { label: 'Advance received',   color: 'var(--blue)' },
  part_invoiced:      { label: 'Part invoiced',      color: 'var(--amber)' },
  part_invoiced_paid: { label: 'Part invoiced · paid', color: 'var(--teal)' },
  invoiced:           { label: 'Awaiting payment',   color: 'var(--amber)' },
  paid:               { label: 'Paid',               color: 'var(--green)' },
};

function useOps() {
  const [data, setData] = useState(null);
  const refresh = useCallback(async () => setData(await loadOpsData()), []);
  useEffect(() => { refresh(); }, [refresh]);
  return [data, refresh];
}

function SetupCard({ data, businesses, onLinked }) {
  const [busy, setBusy] = useState(false);
  if (!data) return <div className="loading">Loading production data…</div>;
  if (!data.ok) {
    return (
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="card-head">Connect the operations app</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 10 }}>
          This screen reads orders, dispatches and staff from the Needle Point operations app, which lives in this same
          Supabase project in its own <code>ops</code> schema. To connect it (full steps in the operations app's <code>MOVE_GUIDE.md</code>):
        </p>
        <ol style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 2, paddingLeft: 20 }}>
          <li>Run the operations app's <code>supabase/ops_install.sql</code> in this project's SQL editor.</li>
          <li>Project Settings → API → Exposed schemas: add <code>ops</code>.</li>
          <li>Run <code>sql/integration/001_link_operations.sql</code>, then come back here.</li>
        </ol>
        <p className="err-msg" style={{ marginTop: 10 }}>Database said: {data.error}</p>
      </div>
    );
  }
  // Normally linked automatically when the app opens; this only shows if that
  // couldn't happen (e.g. no business details yet, or no permission).
  const home = businesses[0];
  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <div className="card-head">Link with the operations app</div>
      {!home ? (
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>Add your business details first (Settings → Business profile). The link then happens on its own.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 12 }}>
            Connect <b>{home.name}</b> with the operations app: brands are matched to your client parties (same GSTIN, or the same name
            ignoring "Pvt Ltd" etc.), anything unsure is left for you to match, and team members become employee parties.
          </p>
          <button className="btn btn-primary" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await setOpsBusiness(home.id);
              toast(r.to_review ? `Linked. ${r.to_review} brand${r.to_review === 1 ? '' : 's'} to match` : 'Linked', 'success', 6000);
              await onLinked(r);
            }
            catch (e) { toast(e.message, 'error'); }
            setBusy(false);
          }}>{busy ? 'Linking…' : 'Link now'}</button>
        </>
      )}
    </div>
  );
}

// ─── PRODUCTION ORDERS ────────────────────────────────────────────────────────
export function ProductionOrdersView({ businesses, parties, invoices, payments, creditNotes = [], challans = [], expenses = [], catalogItems = [], reload }) {
  const [data, refreshOps] = useOps();
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [openKey, setOpenKey] = useState(null);
  const [modal, setModal] = useState(null); // { kind, order, prefill?, editData?, shipIds?, isProforma? }
  const [links, refreshLinks] = useBrandLinks();
  const [showLinks, setShowLinks] = useState(false);
  const toLink = unlinkedBrandCount(links, parties);

  const opsBiz = data?.ok ? data.settings?.ops_business_id : null;
  const orders = useMemo(() => data?.ok ? buildOrders(data, { invoices, payments, challans }) : [], [data, invoices, payments, challans]);
  const rates = useMemo(() => data?.ok ? labourRates(data.employees, data.workLogs) : {}, [data]);
  const biz = businesses.find(b => b.id === opsBiz) || {};
  const partyFor = o => parties.find(p => p.business_id === opsBiz && p.brand_id && p.brand_id === o.brand_id);
  const paysBy = useMemo(() => { const m = {}; payments.forEach(p => { (m[p.invoice_id] ||= []).push(p); }); return m; }, [payments]);

  if (!data || !data.ok || !opsBiz) return <SetupCard data={data} businesses={businesses} onLinked={async r => { await refreshOps(); await refreshLinks(); await reload(); if (r?.to_review) setShowLinks(true); }} />;

  const refreshAll = async () => { await refreshOps(); reload(); };
  const q = search.trim().toLowerCase();
  const shown = orders.filter(o => {
    if (filter === 'open' && o.status === 'paid') return false;
    if (filter === 'to_invoice' && !(o.toInvoiceQty > 0 || (o.dispatched === 0 && o.taxDocs.length === 0))) return false;
    if (filter === 'awaiting' && !(o.taxDocs.length && o.balance > 0.5)) return false;
    if (filter === 'paid' && o.status !== 'paid') return false;
    if (!q) return true;
    return [o.po_number, o.brand?.name, ...o.lines.map(l => l.product.name), ...o.lines.map(l => l.product.style_code)].some(v => (v || '').toLowerCase().includes(q));
  });

  const toInvoiceValue = orders.reduce((s, o) => s + o.lines.reduce((a, l) => a + l.uninvoicedShip.reduce((x, r) => x + Number(r.quantity || 0), 0) * l.rate * (1 + l.gst / 100), 0), 0);
  const awaiting = orders.filter(o => o.taxDocs.length).reduce((s, o) => s + Math.max(0, o.taxDocs.reduce((a, i) => a + invoiceDue(i, paysBy[i.id] || [], creditNotes.filter(c => c.invoice_id === i.id)), 0)), 0);
  const advances = orders.reduce((s, o) => s + o.proformas.reduce((a, i) => a + (paysBy[i.id] || []).reduce((x, p) => x + Number(p.amount), 0), 0), 0);
  const unbilled = orders.filter(o => o.status === 'unbilled' || o.status === 'proforma');

  const open = orders.find(o => o.key === openKey);

  // ── save handlers ──
  async function afterInvoiceSaved(order, rid, shipIds, invTotal) {
    await linkShipments(shipIds, { invoice_id: rid });
    // dispatches that went out on a challan: point the challan at this invoice
    const challanIds = [...new Set((data.shipments || []).filter(s => shipIds.includes(s.id) && s.challan_id).map(s => s.challan_id))];
    for (const cid of challanIds) await supabase.from('delivery_challans').update({ linked_invoice_id: rid, status: 'delivered' }).eq('id', cid);
    // offer to move advance from the order's proforma onto this invoice
    const pf = order.proformas.find(p => (paysBy[p.id] || []).length);
    if (pf) {
      const adv = (paysBy[pf.id] || []).reduce((s, p) => s + Number(p.amount), 0);
      if (adv > 0 && confirm(`${pf.invoice_number} holds an advance of ${fmt(adv)}.\n\nAdjust it against this invoice (up to ${fmt(invTotal)})?`)) {
        const moved = await applyAdvance({ proformaPayments: paysBy[pf.id], toInvoiceId: rid, amountNeeded: invTotal, proformaNumber: pf.invoice_number });
        if (moved > 0) await updateInvoiceStatus(rid, moved >= invTotal - 0.01 ? 'paid' : 'partially_paid');
        toast(`${fmt(moved)} advance adjusted`, 'success');
      }
    }
  }

  function openProforma(o) {
    setModal({ kind: 'invoice', order: o, isProforma: true, prefill: baseFill(o, linesForOrder(o)) });
  }
  function openDispatchInvoice(o) {
    const { lines, shipIds } = linesForDispatches(o);
    setModal({ kind: 'invoice', order: o, shipIds, prefill: baseFill(o, lines) });
  }
  function openFinal(o) {
    const lines = linesForOrder(o, { remainingOnly: true });
    const shipIds = o.lines.flatMap(l => l.uninvoicedShip.map(s => s.id));
    const pf = !o.taxDocs.length ? o.proformas[0] : null;
    if (pf) {
      // Convert the proforma itself, so its advance payments stay attached.
      const num = nextInvNum(invoices.filter(i => i.business_id === opsBiz), false, today());
      setModal({ kind: 'invoice', order: o, shipIds, convert: pf, saveLabel: 'Raise final invoice',
        editData: { ...pf, items: lines, status: 'sent', invoice_number: num, issue_date: today(), due_date: dueFrom(o) } });
    } else {
      setModal({ kind: 'invoice', order: o, shipIds, prefill: baseFill(o, lines) });
    }
  }
  function openChallan(o) {
    const { lines, shipIds } = linesForDispatches(o, { forChallan: true });
    const party = partyFor(o);
    setModal({ kind: 'challan', order: o, shipIds, prefill: {
      business_id: opsBiz, party_id: party?.id || '', ops_order_key: o.key, po_number: o.po_number,
      purpose: 'Sale — tax invoice not yet raised (reconcile ASAP)', dispatch_to: party?.address || '',
      notes: o.po_number ? `PO ${o.po_number}` : '', items: lines,
    } });
  }
  async function closeProforma(pf) {
    if ((paysBy[pf.id] || []).length) { toast(`${pf.invoice_number} still holds an advance — adjust it against an invoice first.`, 'warn'); return; }
    if (!confirm(`Close ${pf.invoice_number}? The order is invoiced, so this proforma is no longer needed. It is kept as cancelled.`)) return;
    try { await updateInvoice(pf.id, { status: 'cancelled' }); toast(`${pf.invoice_number} closed`, 'success'); } catch (e) { toast(e.message, 'error'); }
    refreshAll();
  }
  const dueFrom = o => { const d = Number(o.brand?.payment_terms_days); if (!d) return ''; const t = new Date(); t.setDate(t.getDate() + d); return localISO(t); };
  function baseFill(o, items) {
    return { business_id: opsBiz, party_id: partyFor(o)?.id || '', ops_order_key: o.key, po_number: o.po_number, items, notes: o.po_number ? `Against PO ${o.po_number}` : '', due_date: dueFrom(o) };
  }

  async function onInvoiceSave(invData, items, id) {
    const m = modal;
    const rid = await saveInvoice(invData, items, id);
    if (m.convert) {
      const party = parties.find(p => p.id === invData.party_id);
      const due = invoiceDue({ ...invData }, paysBy[m.convert.id] || []);
      await updateInvoice(m.convert.id, { proforma_number: m.convert.invoice_number, party_gstin_snapshot: party?.gstin || '', status: due <= 0.01 ? 'paid' : (paysBy[m.convert.id] || []).length ? 'partially_paid' : invData.status });
      await linkShipments(m.shipIds, { invoice_id: rid });
      toast(`${m.convert.invoice_number} converted to Tax Invoice ${invData.invoice_number}`, 'success');
    } else if (!m.isProforma) {
      await afterInvoiceSaved(m.order, rid, m.shipIds || [], Number(invData.total));
      toast(`Invoice ${invData.invoice_number} saved for ${m.order.po_number || 'this order'}`, 'success');
    } else toast(`Proforma ${invData.invoice_number} saved — record the advance from Sales → Proforma`, 'success');
    await refreshAll();
  }
  async function onChallanSave(chData, items, id) {
    const cid = await saveChallan({ ...chData, ops_order_key: modal.order.key, po_number: modal.order.po_number }, items, id);
    await linkShipments(modal.shipIds, { challan_id: cid });
    toast(`Challan ${chData.challan_number} saved`, 'success');
    await refreshAll();
  }

  return (
    <>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard label="Not billed yet" value={unbilled.length} color="purple" sub={`${fmt(unbilled.reduce((s, o) => s + o.valueInclGst, 0))} order value`} />
        <StatCard label="Dispatched, not invoiced" value={fmt(toInvoiceValue)} color="amber" sub={`${orders.reduce((s, o) => s + o.toInvoiceQty, 0)} pcs`} />
        <StatCard label="Invoiced, awaiting payment" value={fmt(awaiting)} color="red" sub="across production orders" />
        <StatCard label="Advances held" value={fmt(advances)} color="blue" sub="on open proformas" />
      </div>
      {toLink > 0 && (
        <div className="info-banner" style={{ color: 'var(--amber)', borderColor: '#3a2800', background: '#1a1000', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{toLink} brand{toLink === 1 ? " isn't" : "s aren't"} linked to a client party yet, so their orders can't be billed.</span>
          <button className="btn btn-sm btn-primary" onClick={() => setShowLinks(true)}>🔗 Match brands</button>
        </div>
      )}

      <div className="filter-bar">
        <input placeholder="Search PO, brand, garment, style code…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-ghost btn-sm" onClick={refreshAll}>↻ Reload orders</button>
      </div>
      <div className="chip-row" style={{ marginBottom: 14 }}>
        {[['open', 'Open'], ['to_invoice', 'To invoice'], ['awaiting', 'Awaiting payment'], ['paid', 'Paid'], ['all', 'All']].map(([v, l]) =>
          <button key={v} className={`chip${filter === v ? ' active' : ''}`} onClick={() => setFilter(v)}>{l}</button>)}
      </div>

      {shown.length === 0 ? <EmptyState icon="🧵" message="No orders here" sub={orders.length ? 'Try another filter' : 'Orders created in the operations app appear here automatically'} /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Brand</th><th className="r">Pieces</th><th className="r">Dispatched</th><th className="r">Invoiced</th><th className="r">Order value</th><th className="r">Received</th><th className="r">Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {shown.map(o => {
                const st = STATUS[o.status];
                return (
                  <tr key={o.key} className="clickable" onClick={() => setOpenKey(o.key)}>
                    <td>
                      <div className="mono" style={{ color: 'var(--accent)' }}>{o.po_number || 'No PO'}</div>
                      <div className="hint" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.lines.map(l => l.product.name).join(', ')}</div>
                    </td>
                    <td>{o.brand?.name || '—'}{!partyFor(o) && <div className="hint" style={{ color: 'var(--amber)', textDecoration: 'underline', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setShowLinks(true); }}>not linked: match</div>}</td>
                    <td className="r mono">{o.ordered}</td>
                    <td className="r mono">{o.dispatched || '—'}{o.toInvoiceQty > 0 && <div style={{ fontSize: 10, color: 'var(--amber)' }}>{o.toInvoiceQty} to invoice</div>}</td>
                    <td className="r mono">{o.invoicedQty || '—'}</td>
                    <td className="r mono">{fmt(o.valueInclGst)}</td>
                    <td className="r mono" style={{ color: 'var(--green)' }}>{o.received ? fmt(o.received) : '—'}</td>
                    <td className="r mono" style={{ color: o.balance > 0.5 ? 'var(--amber)' : 'var(--text3)' }}>{o.balance > 0.5 ? fmt(o.balance) : '✓'}</td>
                    <td><span style={{ fontSize: 11, color: st.color, fontWeight: 600 }}>● {st.label}</span></td>
                    <td><button className="btn btn-ghost btn-sm">Open →</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showLinks && <BrandLinksModal data={links} parties={parties} onClose={() => setShowLinks(false)} onChanged={async () => { await refreshLinks(); await reload(); }} />}
      {open && !modal && (
        <OrderDetail order={open} biz={biz} party={partyFor(open)} rates={rates} pieceRates={data.pieceRates || []} employees={data.employees} workLogs={data.workLogs} invoices={invoices} expenses={expenses} paysBy={paysBy}
          onClose={() => setOpenKey(null)}
          actions={{ openProforma, openDispatchInvoice, openFinal, openChallan, closeProforma }} />
      )}
      {modal?.kind === 'invoice' && (
        <InvoiceModal onClose={() => setModal(null)} onSave={onInvoiceSave} businesses={businesses} parties={parties} catalogItems={catalogItems}
          allInvoices={invoices} activeBiz={opsBiz} isProforma={!!modal.isProforma} prefill={modal.prefill} editData={modal.editData} saveLabel={modal.saveLabel} />
      )}
      {modal?.kind === 'challan' && (
        <ChallanModal onClose={() => setModal(null)} onSave={onChallanSave} businesses={businesses} parties={parties}
          allChallans={challans} invoices={invoices} activeBiz={opsBiz} prefill={modal.prefill} />
      )}
    </>
  );
}

function OrderDetail({ order: o, biz, party, rates, pieceRates, employees, workLogs, invoices, expenses, paysBy, onClose, actions }) {
  const empById = Object.fromEntries(employees.map(e => [e.id, e]));
  const sameState = party?.state && biz.state && party.state === biz.state;
  const unchallaned = o.lines.reduce((s, l) => s + l.unchallanedShip.reduce((a, x) => a + Number(x.quantity || 0), 0), 0);
  const po = o.po_number;

  // Profitability (estimate): revenue ex-GST vs material bills tagged with this
  // PO and labour from work logged on these garments at each worker's monthly rate.
  const revenue = o.taxDocs.length ? o.taxDocs.reduce((s, i) => s + Number(i.subtotal || 0), 0) : o.value;
  const material = po ? invoices.filter(i => i.type === 'purchase' && i.status !== 'cancelled' && (i.purchase_order_ref || '').trim().toUpperCase() === po)
    .reduce((s, i) => s + Number(i.subtotal || 0) + (i.itc_eligible === false ? Number(i.tax_amount || 0) : 0), 0) : 0;
  const otherExp = po ? expenses.filter(e => (e.reference || '').trim().toUpperCase() === po).reduce((s, e) => s + Number(e.amount || 0), 0) : 0;
  const pids = new Set(o.lines.map(l => l.product.id));
  let labour = 0, uncosted = 0;
  workLogs.filter(w => pids.has(w.product_id)).forEach(w => {
    const c = logCost(w, empById, pieceRates, rates);
    if (c != null) labour += c; else uncosted++;
  });
  const margin = revenue - material - otherExp - labour;

  return (
    <ModalShell size="modal-xl" onClose={onClose} title={<>{po || 'Order'} · {o.brand?.name || '—'} <span style={{ fontSize: 12, color: STATUS[o.status].color, marginLeft: 8 }}>● {STATUS[o.status].label}</span></>}>
      {!party && <div className="info-banner" style={{ color: 'var(--amber)', borderColor: '#3a2800', background: '#1a1000' }}>This brand isn't linked to a client party yet. Link it in Parties → 🔗 Brand links (or "Match brands" on the orders list), then bill this order.</div>}

      <div className="table-wrap" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr><th>Garment</th><th className="r">Rate</th><th className="r">GST</th><th className="r">Ordered</th><th className="r">Dispatched</th><th className="r">Invoiced</th><th className="r">Dispatched, not invoiced</th></tr></thead>
          <tbody>
            {o.lines.map(l => (
              <tr key={l.product.id}>
                <td>{l.product.name}{l.product.style_code && <span className="hint"> · {l.product.style_code}</span>}{l.isSample && <span className="tag" style={{ marginLeft: 6 }}>sample</span>}</td>
                <td className="r mono">{l.rate ? fmt(l.rate) : <span style={{ color: 'var(--amber)' }}>no rate</span>}</td>
                <td className="r mono">{l.gst}%</td>
                <td className="r mono">{l.ordered}</td>
                <td className="r mono">{l.dispatched || '—'}</td>
                <td className="r mono">{l.invoiced || '—'}</td>
                <td className="r mono" style={{ color: l.uninvoicedShip.length ? 'var(--amber)' : 'var(--text3)' }}>{l.uninvoicedShip.reduce((s, x) => s + Number(x.quantity || 0), 0) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Next step</div>
      {sameState && (
        <div className="hint" style={{ marginBottom: 8, lineHeight: 1.6 }}>
          {party.state} client: dispatches within the state can go on a delivery challan (no e-way bill below ₹{biz.state === 'Delhi' ? '1,00,000' : '50,000'}) and be covered by one tax invoice at the end. The sale itself still needs that invoice.
        </div>
      )}
      <div className="row-actions" style={{ marginBottom: 16, gap: 6 }}>
        {!o.proformas.length && !o.taxDocs.length && <button className="btn btn-ghost" disabled={!party} onClick={() => actions.openProforma(o)}>📋 Proforma for advance</button>}
        {o.toInvoiceQty > 0 && <button className="btn btn-primary" disabled={!party} onClick={() => actions.openDispatchInvoice(o)}>🧾 Invoice dispatched pieces ({o.toInvoiceQty})</button>}
        {unchallaned > 0 && <button className="btn btn-ghost" disabled={!party} onClick={() => actions.openChallan(o)}>🚚 Challan for dispatch ({unchallaned} pcs)</button>}
        {o.remainingQty > 0 && <button className={`btn ${o.toInvoiceQty > 0 ? 'btn-ghost' : 'btn-primary'}`} disabled={!party} onClick={() => actions.openFinal(o)}>
          {!o.taxDocs.length && o.proformas.length ? '✓ Convert proforma to final invoice' : `✓ Final invoice (${o.remainingQty} pcs left)`}</button>}
        {o.taxDocs.length > 0 && o.proformas.map(pf => <button key={pf.id} className="btn btn-ghost btn-sm" onClick={() => actions.closeProforma(pf)}>Close {pf.invoice_number}</button>)}
        {o.remainingQty === 0 && o.toInvoiceQty === 0 && <span className="hint">Everything on this order is invoiced.</span>}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">Documents</div>
          {[...o.docs, ...o.challans.map(c => ({ ...c, invoice_number: c.challan_number, issue_date: c.challan_date, isChallan: true }))].length === 0 && <div className="hint">Nothing raised yet.</div>}
          {o.docs.map(d => {
            const paid = (paysBy[d.id] || []).reduce((s, p) => s + Number(p.amount), 0);
            return (
              <div key={d.id} className="ledger-row">
                <span><span className="mono" style={{ color: 'var(--accent)' }}>{d.invoice_number}</span> <span className="hint">{fmtDate(d.issue_date)} · {d.status.replace('_', ' ')}</span></span>
                <span className="mono" style={{ fontSize: 12 }}>{fmt(d.total)}{paid > 0 && <span style={{ color: 'var(--green)' }}> · paid {fmt(paid)}</span>}</span>
              </div>
            );
          })}
          {o.challans.map(c => (
            <div key={c.id} className="ledger-row">
              <span><span className="mono" style={{ color: 'var(--teal)' }}>{c.challan_number}</span> <span className="hint">challan · {fmtDate(c.challan_date)}{c.linked_invoice_id ? ' · invoiced' : ''}</span></span>
              <span className="mono" style={{ fontSize: 12 }}>{fmt(c.total)}</span>
            </div>
          ))}
          <div className="ledger-row total"><span>Received / balance</span><span className="mono"><span style={{ color: 'var(--green)' }}>{fmt(o.received)}</span> · <span style={{ color: o.balance > 0.5 ? 'var(--amber)' : 'var(--text3)' }}>{o.balance > 0.5 ? fmt(o.balance) : 'settled'}</span></span></div>
        </div>
        <div className="card">
          <div className="card-head">Profitability (estimate)</div>
          <div className="ledger-row"><span>Revenue (ex-GST){!o.taxDocs.length && <span className="hint"> · order value</span>}</span><span className="mono" style={{ color: 'var(--green)' }}>{fmt(revenue)}</span></div>
          <div className="ledger-row"><span>Material bills tagged {po || '—'}</span><span className="mono" style={{ color: 'var(--red)' }}>−{fmt(material)}</span></div>
          {otherExp > 0 && <div className="ledger-row"><span>Expenses referenced {po}</span><span className="mono" style={{ color: 'var(--red)' }}>−{fmt(otherExp)}</span></div>}
          <div className="ledger-row"><span>Labour (logged work × salary or piece rate)</span><span className="mono" style={{ color: 'var(--red)' }}>−{fmt(labour)}</span></div>
          <div className="ledger-row total"><span>Margin</span><span className="mono" style={{ color: margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(margin)}{revenue > 0 && <span className="hint"> · {((margin / revenue) * 100).toFixed(0)}%</span>}</span></div>
          <div className="hint" style={{ marginTop: 8, lineHeight: 1.6 }}>
            Tag fabric/trim purchase bills with this PO number (PO Reference) to count them.
            {uncosted > 0 && ` ${uncosted} work log${uncosted === 1 ? '' : 's'} had no quantity or salary and weren't costed.`}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── PAYROLL ──────────────────────────────────────────────────────────────────
// Monthly salaries from the operations app's team list → one expense per
// person (Wages & Salaries, with its journal entry), never posted twice.
export function PayrollView({ businesses, parties, expenses, reload }) {
  const [data, refreshOps] = useOps();
  const [month, setMonth] = useState(thisMonthKey());
  const [method, setMethod] = useState('NEFT');
  const [amounts, setAmounts] = useState({});
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const opsBiz = data?.ok ? data.settings?.ops_business_id : null;

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }), []);
  if (!data || !data.ok || !opsBiz) return <SetupCard data={data} businesses={businesses} onLinked={async () => { await refreshOps(); reload(); }} />;

  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const logs = data.workLogs.filter(w => monthOf(w.logged_at) === month);
  const rows = data.employees.filter(e => e.active !== false).map(e => {
    const mine = logs.filter(w => w.employee_id === e.id);
    const pieces = mine.reduce((s, w) => s + Number(w.quantity || 0), 0);
    const posted = expenses.find(x => x.employee_id === e.id && x.payroll_month === month);
    const party = parties.find(p => p.business_id === opsBiz && p.employee_id === e.id);
    // piece-rate staff: pieces logged this month × rate (product rate first, then default)
    let earned = 0, unpriced = 0;
    if (e.pay_type === 'piece') mine.forEach(w => { const r = pieceRateFor(data.pieceRates || [], w.work_type, w.product_id); if (!w.quantity) return; if (r == null) unpriced += Number(w.quantity); else earned += Number(r) * Number(w.quantity); });
    const base = e.pay_type === 'piece' ? Math.round(earned) : Number(e.monthly_salary || 0);
    const amount = amounts[e.id] ?? base;
    return { e, entries: mine.length, pieces, posted, party, amount, unpriced, cpp: pieces ? amount / pieces : null };
  });
  const pending = rows.filter(r => !r.posted && Number(r.amount) > 0);
  const chosen = pending.filter(r => picked[r.e.id] !== false);
  const total = rows.reduce((s, r) => s + Number(r.posted ? r.posted.amount : r.amount || 0), 0);
  const totalPieces = rows.reduce((s, r) => s + r.pieces, 0);

  async function post() {
    if (!chosen.length) return;
    if (!confirm(`Post ${label} salaries for ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'} — ${fmt(chosen.reduce((s, r) => s + Number(r.amount), 0))} by ${method}?`)) return;
    setBusy(true);
    const date = month === thisMonthKey() ? today() : monthEnd(month);
    let ok = 0, warn = 0;
    for (const r of chosen) {
      try {
        const res = await saveExpenseWithJournal({
          business_id: opsBiz, category: 'Wages & Salaries', amount: Number(r.amount), expense_date: date,
          description: `Salary ${label} — ${r.e.name}`, vendor_id: r.party?.id || '', method, reference: `SAL-${month}`,
          employee_id: r.e.id, payroll_month: month,
        });
        ok++; if (res?.skipped) warn++;
      } catch (e) { toast(`${r.e.name}: ${e.message}`, 'error'); }
    }
    setBusy(false);
    toast(`${ok} salar${ok === 1 ? 'y' : 'ies'} posted for ${label}${warn ? ` — ${warn} without a journal entry (check Chart of Accounts has "Wages & Salaries" and "Bank Account")` : ''}`, warn ? 'warn' : 'success', 7000);
    reload();
  }

  return (
    <>
      <div className="filter-bar">
        <select value={month} onChange={e => { setMonth(e.target.value); setAmounts({}); setPicked({}); }}>
          {months.map(m => <option key={m} value={m}>{new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</option>)}
        </select>
        <select value={method} onChange={e => setMethod(e.target.value)}>
          {['NEFT', 'IMPS', 'UPI', 'Cash', 'Cheque'].map(m => <option key={m}>{m}</option>)}
        </select>
        <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={post}>{busy ? 'Posting…' : `Post ${chosen.length} salar${chosen.length === 1 ? 'y' : 'ies'}`}</button>
      </div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <StatCard label={`Payroll ${label}`} value={fmt(total)} color="blue" sub={`${rows.length} active staff`} />
        <StatCard label="Posted" value={fmt(rows.filter(r => r.posted).reduce((s, r) => s + Number(r.posted.amount), 0))} color="green" sub={`${rows.filter(r => r.posted).length} people`} />
        <StatCard label="Pieces logged" value={totalPieces} color="purple" sub={`${logs.length} work entries`} />
        <StatCard label="Labour cost / piece" value={totalPieces ? fmt(total / totalPieces) : '—'} color="amber" sub="payroll ÷ pieces logged" />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th></th><th>Employee</th><th>Role</th><th className="r">Work entries</th><th className="r">Pieces</th><th className="r">Salary</th><th className="r">Cost / piece</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.e.id}>
                <td>{!r.posted && Number(r.amount) > 0 && <input type="checkbox" checked={picked[r.e.id] !== false} onChange={ev => setPicked(p => ({ ...p, [r.e.id]: ev.target.checked }))} />}</td>
                <td style={{ fontWeight: 500 }}>{r.e.name}{!r.party && <div className="hint" style={{ color: 'var(--amber)' }}>no employee party yet</div>}</td>
                <td className="hint">{r.e.role || '—'}{r.e.pay_type === 'piece' && <div style={{ color: 'var(--blue)' }}>per piece{r.unpriced ? ` · ${r.unpriced} pcs unpriced` : ''}</div>}</td>
                <td className="r mono">{r.entries || '—'}</td>
                <td className="r mono">{r.pieces || '—'}</td>
                <td className="r">
                  {r.posted ? <span className="mono">{fmt(r.posted.amount)}</span> : (
                    <input type="number" value={amounts[r.e.id] ?? (r.amount || '')} placeholder="0"
                      onChange={ev => setAmounts(a => ({ ...a, [r.e.id]: ev.target.value }))}
                      title="Adjust for leave, overtime or bonus before posting"
                      style={{ width: 110, textAlign: 'right', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 6, padding: '4px 8px', fontFamily: 'var(--mono)' }} />
                  )}
                </td>
                <td className="r mono">{r.cpp ? fmt(r.cpp) : '—'}</td>
                <td>{r.posted ? <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ posted {fmtDate(r.posted.expense_date)}</span>
                  : Number(r.amount) > 0 ? <span className="hint">not posted</span> : <span className="hint" style={{ color: 'var(--amber)' }}>{r.e.pay_type === 'piece' ? 'no priced work' : 'no salary set'}</span>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8}><EmptyState icon="👷" message="No active team members" sub="Add staff with a monthly salary in the operations app (Team)" /></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>Each salary becomes an expense under Wages & Salaries (with its journal entry), dated the last day of the month, against the person's employee party. Posting the same person twice for a month is blocked by the database.</p>
    </>
  );
}
