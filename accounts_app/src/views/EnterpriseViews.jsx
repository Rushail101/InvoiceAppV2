import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/db.js';
import { Badge, StatCard, EmptyState } from '../components/ui.jsx';
import { fmt, fmtDate, getFY } from '../lib/constants.js';

const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
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

// Same month-option builder GSTR-1 uses, so both dropdowns show the same
// "September 2026" style list for the current FY.
function getPeriodOptions() {
  const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const fy = getFY();
  const [sy, ey] = fy.split('-').map(y => parseInt('20' + y, 10));
  return MONTHS.map((m, i) => {
    const year = i < 9 ? sy : ey;
    const month = i < 9 ? i + 4 : i - 8;
    const val = `${year}-${String(month).padStart(2, '0')}`;
    const label = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    return { label, value: val };
  });
}

// ─── GSTR-3B ────────────────────────────────────────────────────────────────
// Book-based review summary computed straight from invoices/credit notes
// already in the app — no separate ledger of its own. "Save Review Snapshot"
// is optional and just records what you reviewed for a period, via
// gst_return_snapshots, so you have a paper trail of what you checked before
// filing on the actual GST portal (this never files anything itself).
export function GSTR3BView({ activeBiz, businesses = [], invoices = [], creditNotes = [], reload }) {
  const periods = getPeriodOptions();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const defaultPeriod = periods.find(p => p.value === currentMonth)?.value || periods[0]?.value;
  const [period, setPeriod] = useState(defaultPeriod);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);

  const bizName = activeBiz ? businesses.find(b => b.id === activeBiz)?.name : 'All Businesses';
  const periodLabel = periods.find(p => p.value === period)?.label || period;

  const loadHistory = async () => {
    let q = supabase.from('gst_return_snapshots').select('*').eq('return_type', 'GSTR-3B').order('period', { ascending: false }).limit(12);
    q = bizFilter(q, activeBiz);
    const { data, error } = await q;
    if (!error) setHistory(data || []);
  };
  useEffect(() => { loadHistory(); }, [activeBiz]);

  const sales = useMemo(() => invoices.filter(i => (!activeBiz || i.business_id === activeBiz) && i.type !== 'purchase' && i.status !== 'cancelled'), [invoices, activeBiz]);
  const purchases = useMemo(() => invoices.filter(i => (!activeBiz || i.business_id === activeBiz) && i.type === 'purchase' && i.status !== 'cancelled'), [invoices, activeBiz]);
  const start = period + '-01';
  const end = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).toISOString().slice(0, 10);
  const inPeriod = d => d >= start && d <= end;
  const s = sales.filter(x => inPeriod(x.issue_date));
  const p = purchases.filter(x => inPeriod(x.issue_date));
  const cn = creditNotes.filter(x => (!activeBiz || x.business_id === activeBiz) && x.note_type !== 'commercial' && inPeriod(x.cn_date));

  const output = { taxable: s.reduce((a, x) => a + num(x.subtotal), 0), cgst: s.reduce((a, x) => a + num(x.cgst_amount), 0), sgst: s.reduce((a, x) => a + num(x.sgst_amount), 0), igst: s.reduce((a, x) => a + num(x.igst_amount), 0) };
  const cnOut = { cgst: cn.reduce((a, x) => a + num(x.cgst_amount), 0), sgst: cn.reduce((a, x) => a + num(x.sgst_amount), 0), igst: cn.reduce((a, x) => a + num(x.igst_amount), 0) };
  const itcRows = p.filter(x => x.itc_eligible !== false);
  const ineligibleRows = p.filter(x => x.itc_eligible === false);
  const itc = { cgst: itcRows.reduce((a, x) => a + num(x.cgst_amount), 0), sgst: itcRows.reduce((a, x) => a + num(x.sgst_amount), 0), igst: itcRows.reduce((a, x) => a + num(x.igst_amount), 0) };
  const ineligible = ineligibleRows.reduce((a, x) => a + num(x.cgst_amount) + num(x.sgst_amount) + num(x.igst_amount), 0);

  const netCGST = Math.max(0, output.cgst - cnOut.cgst);
  const netSGST = Math.max(0, output.sgst - cnOut.sgst);
  const netIGST = Math.max(0, output.igst - cnOut.igst);
  const outputTax = output.cgst + output.sgst + output.igst;
  const creditTax = cnOut.cgst + cnOut.sgst + cnOut.igst;
  const netTax = netCGST + netSGST + netIGST;
  const eligibleITC = itc.cgst + itc.sgst + itc.igst;
  const payable = Math.max(0, netTax - eligibleITC);

  const alreadySaved = history.find(h => h.period === period);

  async function saveSnapshot() {
    if (!activeBiz) { setMsg('Select a business first.'); return; }
    setSaving(true);
    const payload = { business_id: activeBiz, return_type: 'GSTR-3B', period, status: 'reviewed', payload: { outward: output, credit_notes: cnOut, itc, ineligible_itc: ineligible, output_tax: outputTax, credit_tax: creditTax, net_tax: netTax, eligible_itc: eligibleITC, payable } };
    const { error } = await supabase.from('gst_return_snapshots').upsert(payload, { onConflict: 'business_id,return_type,period' });
    setMsg(error ? error.message : `GSTR-3B ${periodLabel} snapshot saved for review.`);
    setSaving(false);
    loadHistory(); reload?.();
  }

  async function exportJSON() {
    const blob = new Blob([JSON.stringify({ business: bizName, period, periodLabel, output, creditNotes: cnOut, itc, ineligibleITC: ineligible, netTax, eligibleITC, payable }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `GSTR3B-${period}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Header controls — mirrors the GSTR-1 header layout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>GSTR-3B Return Summary</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{bizName} — {periodLabel}</div>
        </div>

        <select
          value={period}
          onChange={e => setPeriod(e.target.value)}
          style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 12px', fontFamily: 'var(--font)', fontSize: 13, cursor: 'pointer', outline: 'none' }}
        >
          {periods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        <button className="btn btn-ghost btn-sm" onClick={exportJSON} disabled={s.length === 0 && p.length === 0}>
          ⬇ Export
        </button>
        <button className="btn btn-ghost btn-sm" onClick={saveSnapshot} disabled={saving}>
          {alreadySaved ? '✓ Update Review Snapshot' : '✓ Save Review Snapshot'}
        </button>
      </div>

      {msg && <div style={{ marginBottom: 14, padding: '9px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontSize: 12 }}>{msg}</div>}

      {/* Summary cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)', marginBottom: 20 }}>
        <StatCard label="Taxable Sales" value={fmt(output.taxable)} sub={`${s.length} invoices`} color="blue" />
        <StatCard label="Output GST" value={fmt(netTax)} sub={`Gross ${fmt(outputTax)} − CN ${fmt(creditTax)}`} color="amber" />
        <StatCard label="Eligible ITC" value={fmt(eligibleITC)} sub={`${itcRows.length} purchase bills`} color="green" />
        <StatCard label="Ineligible ITC" value={fmt(ineligible)} sub={`${ineligibleRows.length} purchase bills excluded`} color="red" />
        <StatCard label="Net GST Payable" value={fmt(payable)} sub="Output − Eligible ITC" color="red" />
      </div>

      {(s.length === 0 && p.length === 0) ? (
        <EmptyState icon="🧮" message={`No sale or purchase invoices for ${periodLabel}`} sub="Ensure invoices are saved with status sent/paid/partially_paid — drafts and proforma are excluded" />
      ) : (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div>
            <div className="section-title" style={{ marginTop: 0 }}>Outward Supplies (3.1)</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Component</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  <tr><td>Taxable Value</td><td className="r mono">{fmt(output.taxable)}</td></tr>
                  <tr><td style={{ color: 'var(--blue)' }}>CGST</td><td className="r mono" style={{ color: 'var(--blue)' }}>{fmt(netCGST)}</td></tr>
                  <tr><td style={{ color: 'var(--teal)' }}>SGST</td><td className="r mono" style={{ color: 'var(--teal)' }}>{fmt(netSGST)}</td></tr>
                  <tr><td style={{ color: 'var(--amber)' }}>IGST</td><td className="r mono" style={{ color: 'var(--amber)' }}>{fmt(netIGST)}</td></tr>
                  <tr><td style={{ color: 'var(--text3)' }}>Less: Credit Notes GST</td><td className="r mono" style={{ color: 'var(--text3)' }}>−{fmt(creditTax)}</td></tr>
                  <tr><td style={{ fontWeight: 600 }}>Net Output Tax</td><td className="r mono" style={{ fontWeight: 600 }}>{fmt(netTax)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="section-title" style={{ marginTop: 0 }}>Input Tax Credit (4)</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Component</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  <tr><td style={{ color: 'var(--blue)' }}>CGST</td><td className="r mono" style={{ color: 'var(--blue)' }}>{fmt(itc.cgst)}</td></tr>
                  <tr><td style={{ color: 'var(--teal)' }}>SGST</td><td className="r mono" style={{ color: 'var(--teal)' }}>{fmt(itc.sgst)}</td></tr>
                  <tr><td style={{ color: 'var(--amber)' }}>IGST</td><td className="r mono" style={{ color: 'var(--amber)' }}>{fmt(itc.igst)}</td></tr>
                  <tr><td style={{ fontWeight: 600 }}>Total Eligible ITC</td><td className="r mono" style={{ fontWeight: 600 }}>{fmt(eligibleITC)}</td></tr>
                  <tr><td style={{ color: 'var(--text3)' }}>Ineligible ITC (excluded)</td><td className="r mono" style={{ color: 'var(--text3)' }}>{fmt(ineligible)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot history */}
      {history.length > 0 && (
        <>
          <div className="section-title">Review Snapshot History</div>
          <Table headers={['Period', 'Net Payable', 'Status', 'Saved At']} rows={history.map(h => (
            <tr key={h.id} onClick={() => setPeriod(h.period)} style={{ cursor: 'pointer' }}>
              <td style={{ padding: 9 }}>{h.period}</td>
              <td style={{ padding: 9 }}>{fmt(h.payload?.payable)}</td>
              <td style={{ padding: 9 }}><Badge status={h.status} /></td>
              <td style={{ padding: 9 }}>{fmtDate ? fmtDate(h.updated_at) : new Date(h.updated_at).toLocaleDateString('en-IN')}</td>
            </tr>
          ))} />
        </>
      )}

      {/* Filing reminder */}
      <div style={{ marginTop: 20, padding: '10px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
        ℹ️ GSTR-3B is due by the 20th of the following month (quarterly QRMP filers: 22nd/24th, per state). This is a book-based summary for review only — the actual return, including any RCM liability, must still be filed on the GST portal.
      </div>
    </div>
  );
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
      <td style={{ padding: 9 }}><Badge status={r.action} /></td>
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
