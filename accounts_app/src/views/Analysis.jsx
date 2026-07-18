import { useState } from 'react';
import { fmt } from '../lib/constants.js';
import { StatCard, EmptyState } from '../components/ui.jsx';

// Simple horizontal bar row — used for both the spending-by-category and
// earning-by-party lists below. No charting library needed for this.
function BarRow({ label, sub, amount, pct, color }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
          {sub && <span style={{ fontSize: 10.5, color: 'var(--text4)', marginLeft: 6 }}>{sub}</span>}
        </div>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text2)' }}>{fmt(amount)} <span style={{ color: 'var(--text4)', fontSize: 10.5 }}>({pct.toFixed(1)}%)</span></span>
      </div>
      <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(pct, 1)}%`, background: color, borderRadius: 99 }} />
      </div>
    </div>
  );
}

// Income/spend/net trend — plain SVG bars, no charting library. Works for
// monthly, quarterly, or yearly buckets since it just takes whatever period
// objects it's given. The number above each bar-pair is the net for that
// period (in thousands), colour-coded green/red. Click a period to drill
// into its category breakdown (rendered by the caller, below this chart).
function TrendChart({ periods, selectedKey, onSelect, unitLabel }) {
  if (!periods.length) return null;
  const barW = 16, pairGap = 4, groupW = barW * 2 + pairGap, groupGap = 30;
  const chartH = 130, topPad = 22, bottomPad = 34;
  const width = periods.length * (groupW + groupGap) + groupGap;
  const maxVal = Math.max(1, ...periods.flatMap(m => [m.income, m.spend]));
  const scale = v => (v / maxVal) * chartH;
  const fmtK = v => `${v < 0 ? '-' : ''}₹${(Math.abs(v) / 1000).toFixed(1)}k`;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={Math.max(width, 340)} height={chartH + topPad + bottomPad} style={{ display: 'block' }}>
        <line x1={0} y1={chartH + topPad} x2={width} y2={chartH + topPad} stroke="var(--border2)" strokeWidth="1" />
        {periods.map((m, i) => {
          const gx = groupGap + i * (groupW + groupGap);
          const incH = scale(m.income), spH = scale(m.spend);
          const selected = m.key === selectedKey;
          return (
            <g key={m.key} onClick={() => onSelect(m.key)} style={{ cursor: 'pointer' }}>
              {/* Invisible wide hit-area so clicking near the bars (not just exactly on them) still works */}
              <rect x={gx - 6} y={0} width={groupW + 12} height={chartH + topPad + 16} fill="transparent" />
              {selected && (
                <rect x={gx - 6} y={0} width={groupW + 12} height={chartH + topPad + 16} fill="var(--bg3)" rx={4} />
              )}
              <text x={gx + groupW / 2} y={14} textAnchor="middle" fontSize="10" fontFamily="var(--mono)" fontWeight="700" fill={m.net >= 0 ? 'var(--green)' : 'var(--red)'}>
                {m.net >= 0 ? '+' : ''}{fmtK(m.net)}
              </text>
              <rect x={gx} y={chartH + topPad - incH} width={barW} height={incH} fill="var(--green)" rx={2} opacity={selected || !selectedKey ? 1 : 0.4}>
                <title>{`${m.label} income: ${fmt(m.income)}`}</title>
              </rect>
              <rect x={gx + barW + pairGap} y={chartH + topPad - spH} width={barW} height={spH} fill="var(--red)" rx={2} opacity={selected || !selectedKey ? 1 : 0.4}>
                <title>{`${m.label} spend: ${fmt(m.spend)}`}</title>
              </rect>
              <text x={gx + groupW / 2} y={chartH + topPad + 18} textAnchor="middle" fontSize="10.5" fontFamily="var(--mono)" fontWeight={selected ? 700 : 400} fill={selected ? 'var(--text1)' : 'var(--text3)'}>
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 10.5, color: 'var(--text3)' }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--green)', borderRadius: 2, marginRight: 4 }} />Income</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--red)', borderRadius: 2, marginRight: 4 }} />Spend</span>
        <span>Click a {unitLabel} for its breakdown · hover a bar for the exact figure</span>
      </div>
    </div>
  );
}

export function AnalysisView({ journalEntries, journalLines, accounts, businesses, activeBiz, parties, invoices, payments }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [granularity, setGranularity] = useState('month'); // 'month' | 'quarter' | 'year'
  const [selectedMonth, setSelectedMonth] = useState(null);

  function applyPreset(preset) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (preset === 'this_month') { setDateFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1))); setDateTo(iso(now)); }
    else if (preset === 'last_month') { setDateFrom(iso(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setDateTo(iso(new Date(now.getFullYear(), now.getMonth(), 0))); }
    else if (preset === 'this_fy') {
      const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      setDateFrom(iso(new Date(fyStartYear, 3, 1))); setDateTo(iso(now));
    }
    else if (preset === 'last_fy') {
      const fyStartYear = (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1) - 1;
      setDateFrom(iso(new Date(fyStartYear, 3, 1))); setDateTo(iso(new Date(fyStartYear + 1, 2, 31)));
    }
    else { setDateFrom(''); setDateTo(''); }
  }

  const bizJournals = activeBiz ? journalEntries.filter(j => j.business_id === activeBiz) : journalEntries;
  const inDateRange = d => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  const periodJournals = bizJournals.filter(j => inDateRange(j.entry_date));
  const journalIds = new Set(periodJournals.map(j => j.id));
  const periodLines = (journalLines || []).filter(l => journalIds.has(l.journal_id));

  const acctById = {};
  accounts.forEach(a => { acctById[a.id] = a; });

  // ── Trend — income vs spend vs net, one bucket per month/quarter/FY
  // depending on the granularity toggle. This is what actually answers
  // "which period was down" at a glance instead of reading raw totals.
  // Also tracks a per-category breakdown within each bucket, so clicking one
  // can show exactly where that period's money went. Quarters and years use
  // the Indian financial year (Apr–Mar), consistent with the rest of the app. ──
  function periodKeyLabel(dateStr) {
    const d = new Date(dateStr);
    const y = d.getFullYear(), mo = d.getMonth();
    if (granularity === 'month') {
      const key = dateStr.slice(0, 7);
      const label = new Date(key + '-15').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      return { key, label };
    }
    const fyStartYear = mo >= 3 ? y : y - 1;
    if (granularity === 'quarter') {
      const qNum = Math.floor(((mo + 9) % 12) / 3) + 1;
      return { key: `${fyStartYear}-Q${qNum}`, label: `Q${qNum} FY${String(fyStartYear).slice(2)}-${String(fyStartYear + 1).slice(2)}` };
    }
    // year (FY)
    return { key: `${fyStartYear}`, label: `FY${String(fyStartYear).slice(2)}-${String(fyStartYear + 1).slice(2)}` };
  }

  const journalDateById = {};
  periodJournals.forEach(j => { journalDateById[j.id] = j.entry_date; });
  const trendMap = {};
  periodLines.forEach(l => {
    const d = journalDateById[l.journal_id];
    if (!d) return;
    const { key, label } = periodKeyLabel(d);
    if (!trendMap[key]) trendMap[key] = { key, label, income: 0, spend: 0, spendByAcct: {}, incomeByAcct: {} };
    const acc = acctById[l.account_id];
    if (!acc) return;
    if (l.type === 'debit' && acc.group === 'expense') {
      trendMap[key].spend += Number(l.amount);
      trendMap[key].spendByAcct[acc.name] = (trendMap[key].spendByAcct[acc.name] || 0) + Number(l.amount);
    }
    if (l.type === 'credit' && acc.group === 'income') {
      trendMap[key].income += Number(l.amount);
      trendMap[key].incomeByAcct[acc.name] = (trendMap[key].incomeByAcct[acc.name] || 0) + Number(l.amount);
    }
  });
  const trendData = Object.values(trendMap)
    .map(v => ({ ...v, net: v.income - v.spend }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((v, i, arr) => {
      const prev = arr[i - 1];
      const growth = prev && prev.net !== 0 ? ((v.net - prev.net) / Math.abs(prev.net)) * 100 : null;
      const incomeGrowth = prev && prev.income > 0 ? ((v.income - prev.income) / prev.income) * 100 : null;
      return { ...v, growth, incomeGrowth };
    });

  // ── Spending by category — every expense-account debit line in the
  // period, sourced from the journal so it includes bank-imported spend,
  // manual entries, and posted expenses, not just one table. ──
  const spendByAcct = {};
  let totalSpend = 0;
  periodLines.forEach(l => {
    if (l.type !== 'debit') return;
    const acc = acctById[l.account_id];
    if (!acc || acc.group !== 'expense') return;
    spendByAcct[acc.name] = (spendByAcct[acc.name] || 0) + Number(l.amount);
    totalSpend += Number(l.amount);
  });
  const spendRows = Object.entries(spendByAcct).sort((a, b) => b[1] - a[1]);

  // ── Income by category (Sales Revenue vs Service/Other Income) — same
  // journal-based source, credit side of income-group accounts. ──
  const incomeByAcct = {};
  let totalIncome = 0;
  periodLines.forEach(l => {
    if (l.type !== 'credit') return;
    const acc = acctById[l.account_id];
    if (!acc || acc.group !== 'income') return;
    incomeByAcct[acc.name] = (incomeByAcct[acc.name] || 0) + Number(l.amount);
    totalIncome += Number(l.amount);
  });
  const incomeRows = Object.entries(incomeByAcct).sort((a, b) => b[1] - a[1]);

  // ── Earning by party — from the payments table (has party linkage,
  // which journal_lines don't), excluding money paid OUT against purchase
  // bills so this only reflects money actually received from someone. ──
  const invById = {};
  (invoices || []).forEach(i => { invById[i.id] = i; });
  const bizPayments = (activeBiz ? (payments || []).filter(p => p.business_id === activeBiz) : (payments || []))
    .filter(p => inDateRange(p.payment_date))
    .filter(p => { const inv = invById[p.invoice_id]; return !inv || inv.type !== 'purchase'; });

  const incomeByParty = {};
  let totalReceived = 0;
  bizPayments.forEach(p => {
    const party = (parties || []).find(pt => pt.id === p.party_id);
    const name = party?.name || 'Unlinked / Unknown';
    incomeByParty[name] = (incomeByParty[name] || 0) + Number(p.amount);
    totalReceived += Number(p.amount);
  });
  const partyRows = Object.entries(incomeByParty).sort((a, b) => b[1] - a[1]);

  const net = totalIncome - totalSpend;
  const COLORS = ['var(--accent)', 'var(--blue)', 'var(--purple)', 'var(--amber)', 'var(--green)', '#ff8cc8', '#f97316', '#22d3ee'];

  // ── Financial ratios / KPIs ──────────────────────────────────────────────
  // Gross margin: Sales Revenue minus direct cost of what was sold (Raw
  // Materials / Cost of Goods Sold), as a % of Sales Revenue. Falls back to
  // 0 cost if neither account has any spend recorded, rather than hiding
  // the metric — still useful to see 100% margin flagged as suspicious.
  const salesRevenue = incomeByAcct['Sales Revenue'] || 0;
  const cogs = (spendByAcct['Cost of Goods Sold'] || 0) + (spendByAcct['Raw Materials'] || 0);
  const grossMargin = salesRevenue > 0 ? ((salesRevenue - cogs) / salesRevenue) * 100 : null;
  const netMargin = totalIncome > 0 ? (net / totalIncome) * 100 : null;

  // Current cash balance — all-time Bank Account balance for the business,
  // not scoped to the selected period (a balance is a point-in-time figure,
  // not a period total).
  const allBizJournals = activeBiz ? journalEntries.filter(j => j.business_id === activeBiz) : journalEntries;
  const allJournalIds = new Set(allBizJournals.map(j => j.id));
  const bankAcctIds = new Set(accounts.filter(a => a.name.toLowerCase().includes('bank')).map(a => a.id));
  let cashBalance = 0;
  (journalLines || []).forEach(l => {
    if (!allJournalIds.has(l.journal_id) || !bankAcctIds.has(l.account_id)) return;
    cashBalance += l.type === 'debit' ? Number(l.amount) : -Number(l.amount);
  });

  // Burn rate & runway — only meaningful when the selected period is net
  // negative (spending more than earning). Approximated using the number
  // of months actually covered by the filter.
  const periodMonths = dateFrom && dateTo
    ? Math.max(1, (new Date(dateTo).getFullYear() - new Date(dateFrom).getFullYear()) * 12 + (new Date(dateTo).getMonth() - new Date(dateFrom).getMonth()) + 1)
    : 1;
  const monthlyBurn = net < 0 ? Math.abs(net) / periodMonths : 0;
  const runwayMonths = monthlyBurn > 0 ? cashBalance / monthlyBurn : null;

  // AR / AP outstanding — from invoices directly (not journal, since this
  // system doesn't book AR at invoice time — see the "how it works" note
  // at the bottom).
  const bizInvoices = activeBiz ? (invoices || []).filter(i => i.business_id === activeBiz) : (invoices || []);
  const paidByInv = {};
  (payments || []).forEach(p => { paidByInv[p.invoice_id] = (paidByInv[p.invoice_id] || 0) + Number(p.amount); });
  const arOutstanding = bizInvoices.filter(i => i.type !== 'purchase' && !['cancelled', 'proforma'].includes(i.status))
    .reduce((s, i) => s + Math.max(0, Number(i.total) - (paidByInv[i.id] || 0)), 0);
  const apOutstanding = bizInvoices.filter(i => i.type === 'purchase' && !['cancelled', 'proforma'].includes(i.status))
    .reduce((s, i) => s + Math.max(0, Number(i.total) - (paidByInv[i.id] || 0)), 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {[['this_month', 'This month'], ['last_month', 'Last month'], ['this_fy', 'This FY'], ['last_fy', 'Last FY'], ['', 'All time']].map(([id, label]) => (
          <button key={id || 'all'} className="btn btn-ghost btn-sm" onClick={() => applyPreset(id)}>{label}</button>
        ))}
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ maxWidth: 145 }} title="From date" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ maxWidth: 145 }} title="To date" />
      </div>

      <div className="stats-grid">
        <StatCard label="Total Spent" value={fmt(totalSpend)} color="red" sub={`${spendRows.length} categories`} />
        <StatCard label="Total Earned" value={fmt(totalIncome)} color="green" sub={`${incomeRows.length} categories`} />
        <StatCard label="Net" value={fmt(net)} color={net >= 0 ? 'green' : 'red'} sub={net >= 0 ? 'Profit' : 'Loss'} />
        <StatCard label="Cash Received" value={fmt(totalReceived)} color="blue" sub={`from ${partyRows.length} ${partyRows.length === 1 ? 'party' : 'parties'}`} />
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Key Ratios</div>
      <div className="stats-grid">
        <StatCard label="Gross Margin" value={grossMargin !== null ? `${grossMargin.toFixed(1)}%` : '—'} color={grossMargin === null ? 'blue' : grossMargin >= 30 ? 'green' : grossMargin >= 10 ? 'amber' : 'red'} sub="Sales Revenue − COGS/Raw Materials" />
        <StatCard label="Net Margin" value={netMargin !== null ? `${netMargin.toFixed(1)}%` : '—'} color={netMargin === null ? 'blue' : netMargin >= 0 ? 'green' : 'red'} sub="Net ÷ Total Earned, this period" />
        <StatCard label="Cash Balance" value={fmt(cashBalance)} color={cashBalance >= 0 ? 'blue' : 'red'} sub="Bank Account, all-time" />
        <StatCard label="Runway" value={runwayMonths !== null ? `${runwayMonths.toFixed(1)} mo` : '—'} color={runwayMonths === null ? 'green' : runwayMonths < 3 ? 'red' : runwayMonths < 6 ? 'amber' : 'green'} sub={monthlyBurn > 0 ? `Burning ${fmt(monthlyBurn)}/mo` : 'Not burning cash this period'} />
        <StatCard label="AR Outstanding" value={fmt(arOutstanding)} color="amber" sub="Owed to you by customers" />
        <StatCard label="AP Outstanding" value={fmt(apOutstanding)} color="purple" sub="You owe on purchase bills" />
      </div>

      <div className="table-wrap" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div className="section-title" style={{ marginTop: 0, marginBottom: 0, border: 'none', padding: 0 }}>Trend & Growth</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly']].map(([id, label]) => (
              <button key={id} onClick={() => { setGranularity(id); setSelectedMonth(null); }}
                style={{
                  padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                  background: granularity === id ? 'var(--accent)' : 'var(--bg3)',
                  color: granularity === id ? '#fff' : 'var(--text2)',
                }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 14 }} />

        {trendData.length === 0
          ? <EmptyState icon="📊" message="Not enough data in this period for a trend" />
          : <TrendChart periods={trendData} selectedKey={selectedMonth} onSelect={key => setSelectedMonth(prev => prev === key ? null : key)} unitLabel={granularity} />}

        {trendData.length > 1 && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Growth vs previous {granularity}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => exportGrowthCSV(trendData, granularity)}>↓ CSV</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text3)', fontSize: 10.5, fontFamily: 'var(--mono)' }}>
                  <th style={{ padding: '4px 8px 8px 0', fontWeight: 500 }}>Period</th>
                  <th style={{ padding: '4px 8px 8px', fontWeight: 500 }} className="r">Income</th>
                  <th style={{ padding: '4px 8px 8px', fontWeight: 500 }} className="r">Income growth</th>
                  <th style={{ padding: '4px 8px 8px', fontWeight: 500 }} className="r">Net</th>
                  <th style={{ padding: '4px 0 8px 8px', fontWeight: 500 }} className="r">Net growth</th>
                </tr>
              </thead>
              <tbody>
                {[...trendData].reverse().map(p => (
                  <tr key={p.key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 8px 7px 0' }}>{p.label}</td>
                    <td className="r mono" style={{ padding: '7px 8px' }}>{fmt(p.income)}</td>
                    <td className="r mono" style={{ padding: '7px 8px', color: p.incomeGrowth == null ? 'var(--text4)' : p.incomeGrowth >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {p.incomeGrowth == null ? '—' : `${p.incomeGrowth >= 0 ? '+' : ''}${p.incomeGrowth.toFixed(1)}%`}
                    </td>
                    <td className="r mono" style={{ padding: '7px 8px', color: p.net >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(p.net)}</td>
                    <td className="r mono" style={{ padding: '7px 0 7px 8px', color: p.growth == null ? 'var(--text4)' : p.growth >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {p.growth == null ? '—' : `${p.growth >= 0 ? '+' : ''}${p.growth.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 10, color: 'var(--text4)', fontFamily: 'var(--mono)', marginTop: 8 }}>
              Income growth compares total income only. Net growth compares profit/loss — a swing from a small loss to a small profit can show as a very large % since the base is near zero.
            </p>
          </div>
        )}

        {selectedMonth && (() => {
          const m = trendData.find(x => x.key === selectedMonth);
          if (!m) return null;
          const spendRowsM = Object.entries(m.spendByAcct).sort((a, b) => b[1] - a[1]);
          const incomeRowsM = Object.entries(m.incomeByAcct).sort((a, b) => b[1] - a[1]);
          return (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label} breakdown</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedMonth(null)}>Close ✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
                    Spend — {fmt(m.spend)}
                  </div>
                  {spendRowsM.length === 0

                    ? <p style={{ fontSize: 12, color: 'var(--text4)' }}>No spending this month</p>
                    : spendRowsM.map(([name, amt], i) => (
                        <BarRow key={name} label={name} amount={amt} pct={m.spend ? (amt / m.spend) * 100 : 0} color={COLORS[i % COLORS.length]} />
                      ))}
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
                    Income — {fmt(m.income)}
                  </div>
                  {incomeRowsM.length === 0
                    ? <p style={{ fontSize: 12, color: 'var(--text4)' }}>No income this month</p>
                    : incomeRowsM.map(([name, amt], i) => (
                        <BarRow key={name} label={name} amount={amt} pct={m.income ? (amt / m.income) * 100 : 0} color={COLORS[i % COLORS.length]} />
                      ))}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="table-wrap" style={{ padding: 18 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Where your money is going</div>
          {spendRows.length === 0
            ? <EmptyState icon="💸" message="No spending in this period" />
            : spendRows.map(([name, amt], i) => (
                <BarRow key={name} label={name} amount={amt} pct={totalSpend ? (amt / totalSpend) * 100 : 0} color={COLORS[i % COLORS.length]} />
              ))}
        </div>

        <div className="table-wrap" style={{ padding: 18 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Who you're earning from</div>
          {partyRows.length === 0
            ? <EmptyState icon="🤝" message="No payments received in this period" />
            : partyRows.map(([name, amt], i) => (
                <BarRow key={name} label={name} amount={amt} pct={totalReceived ? (amt / totalReceived) * 100 : 0} color={COLORS[i % COLORS.length]} />
              ))}
        </div>
      </div>

      {incomeRows.length > 0 && (
        <div className="table-wrap" style={{ padding: 18, marginTop: 20 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Income by category</div>
          {incomeRows.map(([name, amt], i) => (
            <BarRow key={name} label={name} amount={amt} pct={totalIncome ? (amt / totalIncome) * 100 : 0} color={COLORS[i % COLORS.length]} />
          ))}
        </div>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--text4)', fontFamily: 'var(--mono)', marginTop: 16 }}>
        Spending/income figures are pulled from Journal Vouchers, so they reflect everything posted there — bank imports, manual entries, expenses, and payments. "Who you're earning from" is pulled from Payments directly, since journal lines don't track which party they belong to. Cash Balance and Runway are all-time/point-in-time figures (not scoped to the date filter above) since a balance only makes sense as of "now," not summed over a period. AR/AP Outstanding come from unpaid Invoices directly — this system doesn't book receivables at invoice time, only when cash actually moves, so these two numbers are the exception that isn't journal-based.
      </p>
    </div>
  );
}

function exportGrowthCSV(trendData, granularity) {
  const headers = ['Period', 'Income', 'Spend', 'Net', 'Income Growth %', 'Net Growth %'];
  const rows = trendData.map(p => [
    p.label, p.income.toFixed(2), p.spend.toFixed(2), p.net.toFixed(2),
    p.incomeGrowth == null ? '' : p.incomeGrowth.toFixed(1),
    p.growth == null ? '' : p.growth.toFixed(1),
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `growth_report_${granularity}.csv`;
  a.click();
}
