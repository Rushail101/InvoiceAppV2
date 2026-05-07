// views/GSTR1.jsx — GSTR-1 Summary Report
import { useState, useMemo } from 'react';
import { fmt, fmtDate, getFY, STATE_CODES } from '../lib/constants.js';
import { EmptyState, PillTabs } from '../components/ui.jsx';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const MONTHS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March'
];

function getPeriodOptions() {
  const fy = getFY();
  const [sy, ey] = fy.split('-').map(y => parseInt('20' + y, 10));
  return MONTHS.map((m, i) => {
    const year = i < 9 ? sy : ey; // Apr-Dec = start year, Jan-Mar = end year
    const month = i < 9 ? i + 4 : i - 8; // Apr=4..Dec=12, Jan=1..Mar=3
    const val = `${year}-${String(month).padStart(2, '0')}`;
    return { label: `${m} ${year}`, value: val };
  });
}

function filterByPeriod(invoices, period) {
  if (!period) return invoices;
  return invoices.filter(inv => {
    if (!inv.issue_date) return false;
    return inv.issue_date.startsWith(period);
  });
}

// Enrich invoices with computed GST amounts from stored fields
function enrichInvoice(inv, parties) {
  const party = parties.find(p => p.id === inv.party_id) || {};
  const isIntra = inv.is_interstate === false;
  const taxable = Number(inv.subtotal || 0);
  const cgst = Number(inv.cgst_amount || 0);
  const sgst = Number(inv.sgst_amount || 0);
  const igst = Number(inv.igst_amount || 0);
  const totalTax = cgst + sgst + igst;
  const total = Number(inv.total || 0);
  return { ...inv, party, isIntra, taxable, cgst, sgst, igst, totalTax, total };
}

// ─── B2B TABLE ────────────────────────────────────────────────────────────────
// B2B: invoices to registered (GSTIN) recipients
function B2BTable({ rows }) {
  if (!rows.length) return <EmptyState icon="📋" message="No B2B invoices for this period" sub="B2B = invoices raised to parties with a valid GSTIN" />;
  const totTaxable = rows.reduce((s, r) => s + r.taxable, 0);
  const totCGST = rows.reduce((s, r) => s + r.cgst, 0);
  const totSGST = rows.reduce((s, r) => s + r.sgst, 0);
  const totIGST = rows.reduce((s, r) => s + r.igst, 0);
  const totTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Date</th>
            <th>Recipient</th>
            <th>GSTIN</th>
            <th>State</th>
            <th>Type</th>
            <th className="r">Taxable (₹)</th>
            <th className="r">CGST</th>
            <th className="r">SGST</th>
            <th className="r">IGST</th>
            <th className="r">Invoice Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{r.invoice_number}</td>
              <td className="mono" style={{ fontSize: 11 }}>{fmtDate(r.issue_date)}</td>
              <td style={{ fontWeight: 500 }}>{r.party?.name || '—'}</td>
              <td className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{r.party?.gstin || '—'}</td>
              <td style={{ fontSize: 11 }}>{r.party?.state || '—'}</td>
              <td>
                <span className={`gst-chip ${r.isIntra ? 'cgst' : 'igst'}`} style={{ fontSize: 9 }}>
                  {r.isIntra ? 'Intra' : 'Inter'}
                </span>
              </td>
              <td className="r mono" style={{ fontSize: 11 }}>{fmt(r.taxable)}</td>
              <td className="r mono" style={{ fontSize: 11, color: r.cgst > 0 ? 'var(--blue)' : 'var(--text4)' }}>{r.cgst > 0 ? fmt(r.cgst) : '—'}</td>
              <td className="r mono" style={{ fontSize: 11, color: r.sgst > 0 ? 'var(--teal)' : 'var(--text4)' }}>{r.sgst > 0 ? fmt(r.sgst) : '—'}</td>
              <td className="r mono" style={{ fontSize: 11, color: r.igst > 0 ? 'var(--amber)' : 'var(--text4)' }}>{r.igst > 0 ? fmt(r.igst) : '—'}</td>
              <td className="r mono" style={{ fontWeight: 600 }}>{fmt(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, background: 'var(--bg3)', borderTop: '2px solid var(--border2)' }}>
            <td colSpan={6} style={{ padding: '9px 16px', fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Total ({rows.length} invoices)
            </td>
            <td className="r mono" style={{ padding: '9px 16px' }}>{fmt(totTaxable)}</td>
            <td className="r mono" style={{ padding: '9px 16px', color: 'var(--blue)' }}>{fmt(totCGST)}</td>
            <td className="r mono" style={{ padding: '9px 16px', color: 'var(--teal)' }}>{fmt(totSGST)}</td>
            <td className="r mono" style={{ padding: '9px 16px', color: 'var(--amber)' }}>{fmt(totIGST)}</td>
            <td className="r mono" style={{ padding: '9px 16px' }}>{fmt(totTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── B2C TABLE ────────────────────────────────────────────────────────────────
// B2C: invoices to unregistered (no GSTIN) or consumers
function B2CTable({ rows }) {
  if (!rows.length) return <EmptyState icon="🛒" message="No B2C invoices for this period" sub="B2C = invoices raised to parties without a GSTIN" />;

  // B2C Large (>2.5L inter-state) goes to B2CL; rest to B2CS grouped by state+rate
  const b2cl = rows.filter(r => !r.isIntra && r.total > 250000);
  const b2cs = rows.filter(r => r.isIntra || r.total <= 250000);

  // Group B2CS by state + supply type
  const b2csGroups = {};
  b2cs.forEach(r => {
    const key = `${r.party?.state || 'Unknown'}|${r.isIntra ? 'Intra' : 'Inter'}`;
    if (!b2csGroups[key]) b2csGroups[key] = { state: r.party?.state || 'Unknown', type: r.isIntra ? 'Intra' : 'Inter', taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, count: 0 };
    b2csGroups[key].taxable += r.taxable;
    b2csGroups[key].cgst += r.cgst;
    b2csGroups[key].sgst += r.sgst;
    b2csGroups[key].igst += r.igst;
    b2csGroups[key].total += r.total;
    b2csGroups[key].count += 1;
  });

  return (
    <div>
      {b2cl.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="section-title">B2C Large (Inter-state invoices &gt; ₹2.5 Lakh)</div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Invoice #</th><th>Date</th><th>Party</th><th>State</th>
                <th className="r">Taxable</th><th className="r">IGST</th><th className="r">Total</th>
              </tr></thead>
              <tbody>
                {b2cl.map(r => (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{r.invoice_number}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{fmtDate(r.issue_date)}</td>
                    <td style={{ fontWeight: 500 }}>{r.party?.name || '—'}</td>
                    <td style={{ fontSize: 11 }}>{r.party?.state || '—'}</td>
                    <td className="r mono" style={{ fontSize: 11 }}>{fmt(r.taxable)}</td>
                    <td className="r mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{fmt(r.igst)}</td>
                    <td className="r mono" style={{ fontWeight: 600 }}>{fmt(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="section-title">B2C Small (Consolidated by State)</div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>State</th><th>Supply Type</th><th className="r">Count</th>
            <th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th><th className="r">Total</th>
          </tr></thead>
          <tbody>
            {Object.values(b2csGroups).map((g, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{g.state}</td>
                <td><span className={`gst-chip ${g.type === 'Intra' ? 'cgst' : 'igst'}`} style={{ fontSize: 9 }}>{g.type}</span></td>
                <td className="r mono" style={{ fontSize: 11 }}>{g.count}</td>
                <td className="r mono" style={{ fontSize: 11 }}>{fmt(g.taxable)}</td>
                <td className="r mono" style={{ fontSize: 11, color: 'var(--blue)' }}>{g.cgst > 0 ? fmt(g.cgst) : '—'}</td>
                <td className="r mono" style={{ fontSize: 11, color: 'var(--teal)' }}>{g.sgst > 0 ? fmt(g.sgst) : '—'}</td>
                <td className="r mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{g.igst > 0 ? fmt(g.igst) : '—'}</td>
                <td className="r mono" style={{ fontWeight: 600 }}>{fmt(g.total)}</td>
              </tr>
            ))}
            {Object.keys(b2csGroups).length === 0 && (
              <tr><td colSpan={8}><EmptyState icon="—" message="No B2C small invoices" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── HSN SUMMARY ─────────────────────────────────────────────────────────────
function HSNTable({ invoices, allItems }) {
  // Group by HSN code across all invoices in the period
  const hsnMap = {};
  invoices.forEach(inv => {
    const items = allItems[inv.id] || [];
    items.forEach(it => {
      const hsn = it.hsn_code || 'Unspecified';
      if (!hsnMap[hsn]) hsnMap[hsn] = { hsn, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
      const taxable = Number(it.taxable_amount || 0);
      hsnMap[hsn].qty += Number(it.quantity || 0);
      hsnMap[hsn].taxable += taxable;
      hsnMap[hsn].cgst += Number(it.cgst_amount || 0);
      hsnMap[hsn].sgst += Number(it.sgst_amount || 0);
      hsnMap[hsn].igst += Number(it.igst_amount || 0);
      hsnMap[hsn].total += Number(it.amount || 0);
    });
  });

  const rows = Object.values(hsnMap);
  if (!rows.length) return <EmptyState icon="🏷️" message="No HSN data available" sub="HSN codes on invoice line items will appear here" />;

  const totTaxable = rows.reduce((s, r) => s + r.taxable, 0);
  const totTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th>HSN / SAC</th><th className="r">Total Qty</th><th className="r">Taxable Value</th>
          <th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th><th className="r">Total Tax</th>
        </tr></thead>
        <tbody>
          {rows.sort((a, b) => b.taxable - a.taxable).map((r, i) => (
            <tr key={i}>
              <td className="mono" style={{ fontWeight: 500, color: 'var(--accent)' }}>{r.hsn}</td>
              <td className="r mono" style={{ fontSize: 11 }}>{r.qty.toFixed(2)}</td>
              <td className="r mono" style={{ fontSize: 11 }}>{fmt(r.taxable)}</td>
              <td className="r mono" style={{ fontSize: 11, color: 'var(--blue)' }}>{r.cgst > 0 ? fmt(r.cgst) : '—'}</td>
              <td className="r mono" style={{ fontSize: 11, color: 'var(--teal)' }}>{r.sgst > 0 ? fmt(r.sgst) : '—'}</td>
              <td className="r mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{r.igst > 0 ? fmt(r.igst) : '—'}</td>
              <td className="r mono" style={{ fontWeight: 600 }}>{fmt(r.cgst + r.sgst + r.igst)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, background: 'var(--bg3)', borderTop: '2px solid var(--border2)' }}>
            <td colSpan={2} style={{ padding: '9px 16px', fontFamily: 'var(--mono)', fontSize: 11 }}>TOTAL</td>
            <td className="r mono" style={{ padding: '9px 16px' }}>{fmt(totTaxable)}</td>
            <td className="r mono" style={{ padding: '9px 16px', color: 'var(--blue)' }}>{fmt(rows.reduce((s, r) => s + r.cgst, 0))}</td>
            <td className="r mono" style={{ padding: '9px 16px', color: 'var(--teal)' }}>{fmt(rows.reduce((s, r) => s + r.sgst, 0))}</td>
            <td className="r mono" style={{ padding: '9px 16px', color: 'var(--amber)' }}>{fmt(rows.reduce((s, r) => s + r.igst, 0))}</td>
            <td className="r mono" style={{ padding: '9px 16px' }}>{fmt(totTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── GST SUMMARY CARD ─────────────────────────────────────────────────────────
function GSTSummaryCards({ invoices }) {
  const totTaxable = invoices.reduce((s, r) => s + r.taxable, 0);
  const totCGST = invoices.reduce((s, r) => s + r.cgst, 0);
  const totSGST = invoices.reduce((s, r) => s + r.sgst, 0);
  const totIGST = invoices.reduce((s, r) => s + r.igst, 0);
  const totTax = totCGST + totSGST + totIGST;
  const totInvoiced = invoices.reduce((s, r) => s + r.total, 0);
  const b2bCount = invoices.filter(r => r.party?.gstin).length;
  const b2cCount = invoices.filter(r => !r.party?.gstin).length;

  return (
    <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(6,1fr)', marginBottom: 20 }}>
      {[
        { label: 'Total Invoices', value: invoices.length, sub: `B2B: ${b2bCount} · B2C: ${b2cCount}`, color: 'blue' },
        { label: 'Taxable Value', value: fmt(totTaxable), color: 'blue' },
        { label: 'CGST', value: fmt(totCGST), sub: 'Central GST', color: 'blue' },
        { label: 'SGST', value: fmt(totSGST), sub: 'State GST', color: 'green' },
        { label: 'IGST', value: fmt(totIGST), sub: 'Inter-state', color: 'amber' },
        { label: 'Total Tax Liability', value: fmt(totTax), color: 'red' },
      ].map((c, i) => (
        <div key={i} className={`stat-card ${c.color}`}>
          <div className="stat-label">{c.label}</div>
          <div className={`stat-val ${c.color}`} style={{ fontSize: 16 }}>{c.value}</div>
          {c.sub && <div className="stat-sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── MAIN GSTR-1 VIEW ─────────────────────────────────────────────────────────
export function GSTR1View({ invoices, parties, businesses, activeBiz, invoiceItems }) {
  const periods = getPeriodOptions();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const defaultPeriod = periods.find(p => p.value === currentMonth)?.value || periods[0]?.value;
  const [period, setPeriod] = useState(defaultPeriod);
  const [activeTab, setActiveTab] = useState('summary');

  // Only sale invoices that are not draft/cancelled/proforma
  const eligibleInvoices = useMemo(() =>
    invoices.filter(inv => {
      const bizMatch = activeBiz ? inv.business_id === activeBiz : true;
      const isEligible = inv.type === 'sale' && !['draft', 'cancelled', 'proforma'].includes(inv.status);
      return bizMatch && isEligible;
    }),
    [invoices, activeBiz]
  );

  const periodInvoices = useMemo(() =>
    filterByPeriod(eligibleInvoices, period).map(inv => enrichInvoice(inv, parties)),
    [eligibleInvoices, period, parties]
  );

  // Build items lookup: invoice_id -> items[]
  const allItems = useMemo(() => {
    const map = {};
    (invoiceItems || []).forEach(it => {
      if (!map[it.invoice_id]) map[it.invoice_id] = [];
      map[it.invoice_id].push(it);
    });
    return map;
  }, [invoiceItems]);

  // Split into B2B and B2C
  const b2bInvoices = periodInvoices.filter(r => r.party?.gstin);
  const b2cInvoices = periodInvoices.filter(r => !r.party?.gstin);

  // Selected business name for header
  const bizName = activeBiz ? businesses.find(b => b.id === activeBiz)?.name : 'All Businesses';
  const selectedPeriodLabel = periods.find(p => p.value === period)?.label || period;

  function exportCSV(rows, filename) {
    const headers = ['Invoice #', 'Date', 'Party', 'GSTIN', 'State', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'];
    const lines = rows.map(r => [
      r.invoice_number, r.issue_date, r.party?.name || '', r.party?.gstin || '',
      r.party?.state || '', r.taxable.toFixed(2), r.cgst.toFixed(2),
      r.sgst.toFixed(2), r.igst.toFixed(2), r.total.toFixed(2)
    ]);
    const csv = [headers, ...lines].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  const tabs = [
    { id: 'summary', label: '📊 Summary' },
    { id: 'b2b', label: `📋 B2B (${b2bInvoices.length})` },
    { id: 'b2c', label: `🛒 B2C (${b2cInvoices.length})` },
    { id: 'hsn', label: '🏷️ HSN Summary' },
  ];

  if (!activeBiz && businesses.length === 0) {
    return <EmptyState icon="🏢" message="No businesses configured" sub="Add a business first" />;
  }

  return (
    <div>
      {/* Header controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 3 }}>GSTR-1 Return Summary</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{bizName} — {selectedPeriodLabel}</div>
        </div>
        <select
          value={period}
          onChange={e => setPeriod(e.target.value)}
          style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--r)', padding: '7px 12px', fontFamily: 'var(--font)', fontSize: 13, cursor: 'pointer', outline: 'none' }}
        >
          {periods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => exportCSV(b2bInvoices, `GSTR1-B2B-${period}.csv`)}
          disabled={b2bInvoices.length === 0}
        >
          ⬇ B2B CSV
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => exportCSV(periodInvoices, `GSTR1-All-${period}.csv`)}
          disabled={periodInvoices.length === 0}
        >
          ⬇ Export All
        </button>
      </div>

      {/* GST Summary Cards */}
      {periodInvoices.length > 0 && <GSTSummaryCards invoices={periodInvoices} />}

      {/* Tabs */}
      <PillTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'summary' && (
        <div>
          {periodInvoices.length === 0 ? (
            <EmptyState icon="📊" message={`No invoices for ${selectedPeriodLabel}`} sub="Ensure invoices are saved with status sent/paid/partially_paid — drafts are excluded" />
          ) : (
            <div>
              {/* State-wise breakdown */}
              <div className="section-title" style={{ marginTop: 0 }}>State-wise GST Breakdown</div>
              <div className="table-wrap" style={{ marginBottom: 16 }}>
                <table>
                  <thead><tr>
                    <th>State</th><th>State Code</th><th className="r">Invoices</th>
                    <th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th><th className="r">Total Tax</th>
                  </tr></thead>
                  <tbody>
                    {(() => {
                      const stateMap = {};
                      periodInvoices.forEach(r => {
                        const state = r.party?.state || 'Unknown';
                        if (!stateMap[state]) stateMap[state] = { state, count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
                        stateMap[state].count++;
                        stateMap[state].taxable += r.taxable;
                        stateMap[state].cgst += r.cgst;
                        stateMap[state].sgst += r.sgst;
                        stateMap[state].igst += r.igst;
                      });
                      return Object.values(stateMap).sort((a, b) => b.taxable - a.taxable).map((g, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 500 }}>{g.state}</td>
                          <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{STATE_CODES[g.state] || '—'}</td>
                          <td className="r mono" style={{ fontSize: 11 }}>{g.count}</td>
                          <td className="r mono" style={{ fontSize: 11 }}>{fmt(g.taxable)}</td>
                          <td className="r mono" style={{ fontSize: 11, color: 'var(--blue)' }}>{g.cgst > 0 ? fmt(g.cgst) : '—'}</td>
                          <td className="r mono" style={{ fontSize: 11, color: 'var(--teal)' }}>{g.sgst > 0 ? fmt(g.sgst) : '—'}</td>
                          <td className="r mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{g.igst > 0 ? fmt(g.igst) : '—'}</td>
                          <td className="r mono" style={{ fontWeight: 600 }}>{fmt(g.cgst + g.sgst + g.igst)}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Rate-wise breakdown */}
              <div className="section-title">Rate-wise GST Breakdown</div>
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>GST Rate</th><th className="r">Taxable Value</th>
                    <th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th><th className="r">Total Tax</th>
                  </tr></thead>
                  <tbody>
                    {(() => {
                      // We need invoice items to get rate-wise breakdown
                      const rateMap = {};
                      periodInvoices.forEach(inv => {
                        const items = allItems[inv.id] || [];
                        if (items.length > 0) {
                          items.forEach(it => {
                            const rate = Number(it.tax_percent || 0);
                            const key = `${rate}%`;
                            if (!rateMap[key]) rateMap[key] = { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
                            rateMap[key].taxable += Number(it.taxable_amount || 0);
                            rateMap[key].cgst += Number(it.cgst_amount || 0);
                            rateMap[key].sgst += Number(it.sgst_amount || 0);
                            rateMap[key].igst += Number(it.igst_amount || 0);
                          });
                        } else {
                          // Fallback: use invoice-level amounts
                          const key = 'Mixed';
                          if (!rateMap[key]) rateMap[key] = { rate: null, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
                          rateMap[key].taxable += inv.taxable;
                          rateMap[key].cgst += inv.cgst;
                          rateMap[key].sgst += inv.sgst;
                          rateMap[key].igst += inv.igst;
                        }
                      });
                      return Object.values(rateMap).sort((a, b) => (a.rate || 0) - (b.rate || 0)).map((g, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{g.rate !== null ? `${g.rate}%` : 'Mixed'}</td>
                          <td className="r mono" style={{ fontSize: 11 }}>{fmt(g.taxable)}</td>
                          <td className="r mono" style={{ fontSize: 11, color: 'var(--blue)' }}>{g.cgst > 0 ? fmt(g.cgst) : '—'}</td>
                          <td className="r mono" style={{ fontSize: 11, color: 'var(--teal)' }}>{g.sgst > 0 ? fmt(g.sgst) : '—'}</td>
                          <td className="r mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{g.igst > 0 ? fmt(g.igst) : '—'}</td>
                          <td className="r mono" style={{ fontWeight: 600 }}>{fmt(g.cgst + g.sgst + g.igst)}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'b2b' && <B2BTable rows={b2bInvoices} />}
      {activeTab === 'b2c' && <B2CTable rows={b2cInvoices} />}
      {activeTab === 'hsn' && <HSNTable invoices={periodInvoices} allItems={allItems} />}

      {/* Filing reminder */}
      <div style={{ marginTop: 20, padding: '10px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
        ℹ️ GSTR-1 is due by the 11th of the following month (quarterly filers: last day of month after quarter). This is a summary view — file on the GST portal using these figures.
      </div>
    </div>
  );
}
