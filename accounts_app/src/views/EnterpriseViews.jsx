import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/db.js';
import { Badge } from '../components/ui.jsx';

const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const monthNow = () => new Date().toISOString().slice(0, 7);
const bizFilter = (q, activeBiz) => activeBiz ? q.eq('business_id', activeBiz) : q;
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

// ─── GSTR-3B ────────────────────────────────────────────────────────────────
// Book-based review summary computed straight from invoices/credit notes
// already in the app — no separate ledger of its own. "Save Review Snapshot"
// is optional and just records what you reviewed for a period, via
// gst_return_snapshots, so you have a paper trail of what you checked before
// filing on the actual GST portal (this never files anything itself).
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

// ─── Audit Trail ────────────────────────────────────────────────────────────
export function AuditTrailView({ activeBiz }) {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    (async () => {
      let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
      q = bizFilter(q, activeBiz);
      const { data, error } = await q;
      if (error) setMsg(error.message); else setRows(data || []);
    })();
  }, [activeBiz]);
  return <Shell title="Audit Trail" subtitle="Immutable operational history for key accounting and document changes.">
    {msg && <div className="card" style={{ marginBottom: 12 }}>{msg}</div>}
    <Table headers={['Time', 'User', 'Action', 'Table', 'Record', 'Summary']} rows={rows.map(r => <tr key={r.id}>
      <td style={{ padding: 9 }}>{new Date(r.created_at).toLocaleString('en-IN')}</td>
      <td style={{ padding: 9 }}>{r.user_email || 'System'}</td>
      <td style={{ padding: 9 }}><Badge>{r.action}</Badge></td>
      <td style={{ padding: 9 }}>{r.table_name}</td>
      <td style={{ padding: 9, fontFamily: 'var(--mono)' }}>{String(r.record_id || '').slice(0, 8)}</td>
      <td style={{ padding: 9 }}>{r.summary || '—'}</td>
    </tr>)} />
  </Shell>;
}

// ─── Management Dashboard ───────────────────────────────────────────────────
export function KPIDashboard({ activeBiz, invoices = [], expenses = [], payments = [], parties = [] }) {
  const inv = invoices.filter(i => !activeBiz || i.business_id === activeBiz);
  const exp = expenses.filter(i => !activeBiz || i.business_id === activeBiz);
  const pay = payments.filter(i => !activeBiz || i.business_id === activeBiz);
  const sales = inv.filter(i => i.type !== 'purchase' && i.status !== 'cancelled').reduce((a, x) => a + num(x.total), 0);
  const purchases = inv.filter(i => i.type === 'purchase' && i.status !== 'cancelled').reduce((a, x) => a + num(x.total), 0);
  const receivable = inv.filter(i => i.type !== 'purchase' && !['cancelled', 'proforma'].includes(i.status)).reduce((a, x) => a + Math.max(0, num(x.total) - pay.filter(p => p.invoice_id === x.id).reduce((s, p) => s + num(p.amount), 0)), 0);
  const payable = inv.filter(i => i.type === 'purchase' && !['cancelled', 'proforma'].includes(i.status)).reduce((a, x) => a + Math.max(0, num(x.total) - pay.filter(p => p.invoice_id === x.id).reduce((s, p) => s + num(p.amount), 0)), 0);
  return <Shell title="Management Dashboard" subtitle="Exception-first KPIs across sales, purchases and working capital.">
    <div className="grid-4">{[['Revenue', sales], ['Purchases', purchases], ['Receivables', receivable], ['Payables', payable]].map(([a, b]) => <div className="metric card" key={a}><span>{a}</span><strong>{money(b)}</strong></div>)}</div>
    <div className="grid-2" style={{ marginTop: 18 }}>
      <div className="card"><div className="card-head">Operational Signals</div><div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
        <div>👥 Active parties <strong>{parties.filter(p => !activeBiz || p.business_id === activeBiz).length}</strong></div>
        <div>🧾 Open sales invoices <strong>{inv.filter(i => !['paid', 'cancelled', 'proforma'].includes(i.status) && i.type !== 'purchase').length}</strong></div>
        <div>💸 Expenses <strong>{money(exp.reduce((a, x) => a + num(x.amount), 0))}</strong></div>
        <div>💳 Payments recorded <strong>{money(pay.reduce((a, x) => a + num(x.amount), 0))}</strong></div>
      </div></div>
      <div className="card"><div className="card-head">Automation Philosophy</div><p style={{ color: 'var(--text2)', lineHeight: 1.7, fontSize: 13 }}>Enter once → post once → reconcile automatically → review exceptions. GST calculations, numbering and workflow rules stay deterministic; no paid AI/API is required.</p></div>
    </div>
  </Shell>;
}
